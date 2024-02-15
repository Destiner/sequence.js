import { BytesLike, ethers } from 'ethers'
import { BigIntish } from '@0xsequence/utils'
import { subdigestOf } from './signature'
import { walletContracts } from '@0xsequence/abi'

export interface Transaction {
  to: string
  value?: BigIntish
  data?: BytesLike
  gasLimit?: BigIntish
  delegateCall?: boolean
  revertOnError?: boolean
}

export interface SimulatedTransaction extends Transaction {
  succeeded: boolean
  executed: boolean
  gasUsed: number
  gasLimit: number
  result?: string
  reason?: string
}

export interface TransactionEncoded {
  delegateCall: boolean
  revertOnError: boolean
  gasLimit: BigIntish
  target: string
  value: BigIntish
  data: BytesLike
}

export type Transactionish = ethers.TransactionRequest | ethers.TransactionRequest[] | Transaction | Transaction[]

export interface TransactionResponse<R = any> extends ethers.TransactionResponse {
  receipt?: R
}

export type TransactionBundle = {
  entrypoint: string
  transactions: Transaction[]
  nonce?: BigIntish
}

export type IntendedTransactionBundle = TransactionBundle & {
  chainId: BigIntish
  intent: {
    id: string
    wallet: string
  }
}

export type SignedTransactionBundle = IntendedTransactionBundle & {
  signature: string
  nonce: BigIntish
}

export type RelayReadyTransactionBundle = SignedTransactionBundle | IntendedTransactionBundle

export const MetaTransactionsType = `tuple(
  bool delegateCall,
  bool revertOnError,
  uint256 gasLimit,
  address target,
  uint256 value,
  bytes data
)[]`

export function intendTransactionBundle(
  bundle: TransactionBundle,
  wallet: string,
  chainId: BigIntish,
  id: string
): IntendedTransactionBundle {
  return {
    ...bundle,
    chainId,
    intent: { id: id, wallet }
  }
}

export function intendedTransactionID(bundle: IntendedTransactionBundle) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint256', 'bytes32'],
      [bundle.intent.wallet, bundle.chainId, bundle.intent.id]
    )
  )
}

export function unpackMetaTransactionsData(data: BytesLike): [bigint, TransactionEncoded[]] {
  const res = ethers.AbiCoder.defaultAbiCoder().decode(['uint256', MetaTransactionsType], data)
  if (res.length !== 2 || !res[0] || !res[1]) throw new Error('Invalid meta transaction data')
  return [res[0], res[1]]
}

export function packMetaTransactionsData(nonce: BigIntish, txs: Transaction[]): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(['uint256', MetaTransactionsType], [nonce, sequenceTxAbiEncode(txs)])
}

export function digestOfTransactions(nonce: BigIntish, txs: Transaction[]) {
  return ethers.keccak256(packMetaTransactionsData(nonce, txs))
}

export function subdigestOfTransactions(address: string, chainId: BigIntish, nonce: BigIntish, txs: Transaction[]): string {
  return subdigestOf({ address, chainId, digest: digestOfTransactions(nonce, txs) })
}

export function subdigestOfGuestModuleTransactions(guestModule: string, chainId: BigIntish, txs: Transaction[]): string {
  return subdigestOf({
    address: guestModule,
    chainId,
    digest: ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(['string', MetaTransactionsType], ['guest:', sequenceTxAbiEncode(txs)])
    )
  })
}

export function toSequenceTransactions(
  wallet: string,
  txs: ethers.TransactionRequest[]
): { nonce?: BigIntish; transaction: Transaction }[] {
  return txs.map(tx => toSequenceTransaction(wallet, tx))
}

export function toSequenceTransaction(
  wallet: string,
  tx: ethers.TransactionRequest
): { nonce?: BigIntish; transaction: Transaction } {
  if (tx.to && tx.to !== ethers.ZeroAddress) {
    return {
      nonce: tx.nonce ? BigInt(tx.nonce) : undefined,
      transaction: {
        delegateCall: false,
        revertOnError: false,
        gasLimit: BigInt(tx.gasLimit || 0),
        // XXX: `tx.to` could also be ethers Addressable type which returns a getAddress promise
        // Keeping this as is for now so we don't have to change everything to async
        to: tx.to as string,
        value: BigInt(tx.value || 0),
        data: tx.data || '0x'
      }
    }
  } else {
    const walletInterface = new ethers.Interface(walletContracts.mainModule.abi)
    const data = walletInterface.encodeFunctionData(walletInterface.getFunction('createContract')!, [tx.data])

    return {
      nonce: tx.nonce ? BigInt(tx.nonce) : undefined,
      transaction: {
        delegateCall: false,
        revertOnError: false,
        gasLimit: tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
        to: wallet,
        value: BigInt(tx.value || 0),
        data: data
      }
    }
  }
}

export function isSequenceTransaction(tx: any): tx is Transaction {
  return tx.delegateCall !== undefined || tx.revertOnError !== undefined
}

export function hasSequenceTransactions(txs: any[]): txs is Transaction[] {
  return txs.every(isSequenceTransaction)
}

// TODO: We may be able to remove this if we make Transaction === TransactionEncoded
export function sequenceTxAbiEncode(txs: Transaction[]): TransactionEncoded[] {
  return txs.map(t => ({
    delegateCall: t.delegateCall === true,
    revertOnError: t.revertOnError === true,
    gasLimit: t.gasLimit !== undefined ? t.gasLimit : 0n,
    target: t.to ?? ethers.ZeroAddress,
    value: t.value !== undefined ? t.value : 0n,
    data: t.data !== undefined ? t.data : new Uint8Array()
  }))
}

export function fromTxAbiEncode(txs: TransactionEncoded[]): Transaction[] {
  return txs.map(t => ({
    delegateCall: t.delegateCall,
    revertOnError: t.revertOnError,
    gasLimit: t.gasLimit,
    to: t.target,
    value: t.value,
    data: t.data
  }))
}

// export function appendNonce(txs: Transaction[], nonce: BigIntish): Transaction[] {
//   return txs.map((t: Transaction) => ({ ...t, nonce }))
// }

export function encodeNonce(space: BigIntish, nonce: BigIntish): bigint {
  const bspace = BigInt(space)
  const bnonce = BigInt(nonce)

  const shl = 2n ** 96n

  if (bnonce / shl !== 0n) {
    throw new Error('Space already encoded')
  }

  return bnonce + bspace * shl
}

export function decodeNonce(nonce: BigIntish): [bigint, bigint] {
  const bnonce = BigInt(nonce)
  const shr = 2n ** 96n

  return [bnonce / shr, bnonce % shr]
}

export function fromTransactionish(wallet: string, transaction: Transactionish): Transaction[] {
  if (Array.isArray(transaction)) {
    if (hasSequenceTransactions(transaction)) {
      return transaction
    } else {
      const stx = toSequenceTransactions(wallet, transaction)
      return stx.map(t => t.transaction)
    }
  } else if (isSequenceTransaction(transaction)) {
    return [transaction]
  } else {
    return [toSequenceTransaction(wallet, transaction).transaction]
  }
}

export function isTransactionBundle(cand: any): cand is TransactionBundle {
  return (
    cand !== undefined &&
    cand.entrypoint !== undefined &&
    cand.chainId !== undefined &&
    cand.transactions !== undefined &&
    cand.nonce !== undefined &&
    cand.intent !== undefined &&
    cand.intent.id !== undefined &&
    cand.intent.wallet !== undefined &&
    Array.isArray(cand.transactions) &&
    (<TransactionBundle>cand).transactions.reduce((p, c) => p && isSequenceTransaction(c), true)
  )
}

export function isSignedTransactionBundle(cand: any): cand is SignedTransactionBundle {
  return cand !== undefined && cand.signature !== undefined && cand.signature !== '' && isTransactionBundle(cand)
}

export function encodeBundleExecData(bundle: TransactionBundle): string {
  const walletInterface = new ethers.Interface(walletContracts.mainModule.abi)
  return walletInterface.encodeFunctionData(
    walletInterface.getFunction('execute')!,
    isSignedTransactionBundle(bundle)
      ? [
          // Signed transaction bundle has all 3 parameters
          sequenceTxAbiEncode(bundle.transactions),
          bundle.nonce,
          bundle.signature
        ]
      : [
          // Unsigned bundle may be a GuestModule call, so signature and nonce are missing
          sequenceTxAbiEncode(bundle.transactions),
          0,
          []
        ]
  )
}

// TODO: Use Sequence ABI package
export const selfExecuteSelector = '0x61c2926c'
export const selfExecuteAbi = `tuple(
  bool delegateCall,
  bool revertOnError,
  uint256 gasLimit,
  address target,
  uint256 value,
  bytes data
)[]`

// Splits Sequence batch transactions into individual parts
export const unwind = (wallet: string, transactions: Transaction[]): Transaction[] => {
  const unwound: Transaction[] = []

  const walletInterface = new ethers.Interface(walletContracts.mainModule.abi)

  for (const tx of transactions) {
    const txData = ethers.getBytes(tx.data || '0x')

    if (tx.to === wallet && ethers.toBeHex(ethers.hexlify(txData.slice(0, 4))) === selfExecuteSelector) {
      // Decode as selfExecute call
      const data = txData.slice(4)
      const decoded = ethers.AbiCoder.defaultAbiCoder().decode([selfExecuteAbi], data)[0]
      unwound.push(
        ...unwind(
          tx.to,
          decoded.map((d: TransactionEncoded) => ({ ...d, to: d.target }))
        )
      )
    } else {
      try {
        const innerTransactions = walletInterface.decodeFunctionData('execute', txData)[0]
        const unwoundTransactions = unwind(
          wallet,
          innerTransactions.map((tx: TransactionEncoded) => ({ ...tx, to: tx.target }))
        )
        unwound.push(...unwoundTransactions)
      } catch {
        unwound.push(tx)
      }
    }
  }

  return unwound
}
