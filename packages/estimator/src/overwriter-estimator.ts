import { ethers } from "ethers"
import { isBigNumberish } from '@0xsequence/utils'

const GasEstimator = require("@0xsequence/wallet-contracts/artifacts/contracts/modules/utils/GasEstimator.sol/GasEstimator.json")

function toQuantity(number: ethers.BigNumberish | string): string {
  if (isBigNumberish(number)) {
    return ethers.BigNumber.from(number).toHexString()
  }

  return number
}

function toHexNumber(number: ethers.BigNumberish): string {
  return ethers.BigNumber.from(number).toHexString()
}

function txBaseCost(data: ethers.BytesLike): number {
  const bytes = ethers.utils.arrayify(data)
  return bytes.reduce((p, c) => c == 0 ? p.add(4) : p.add(16), ethers.constants.Zero).add(21000).toNumber()
}

export class OverwriterEstimator {
  public provider: ethers.providers.JsonRpcProvider

  constructor(public rpc: string | ethers.providers.JsonRpcProvider) {
    this.provider = typeof(this.rpc) === 'string' ? new ethers.providers.JsonRpcProvider(this.rpc) : this.rpc
  }

  async estimate(args: {
    to: string,
    from?: string,
    data?: ethers.BytesLike,
    gasPrice?: ethers.BigNumberish,
    gas?: ethers.BigNumberish,
    overwrites?: {
      address: string,
      code?: string,
      balance?: ethers.BigNumberish,
      nonce?: ethers.BigNumberish,
      stateDiff?: {
        key: string,
        value: string,
      }[],
      state?: {
        key: string,
        value: string,
      }[]
    }[],
    blockTag?: string | ethers.BigNumberish
  }): Promise<ethers.BigNumber> {
    const blockTag = args.blockTag ? toQuantity(args.blockTag) : "latest"
    const data = args.data ? args.data : []
    const from = args.from ? ethers.utils.getAddress(args.from) : ethers.Wallet.createRandom().address

    const gasEstimatorInterface = new ethers.utils.Interface(GasEstimator.abi)
    const encodedEstimate = gasEstimatorInterface.encodeFunctionData("estimate", [args.to, data])

    const providedOverwrites = args.overwrites ? args.overwrites.reduce((p, o) => {
      const address = ethers.utils.getAddress(o.address)

      if (address === from) {
        throw Error("Can't overwrite from address values")
      }

      return {
        ...p,
        [address]: {
          code: o.code ? ethers.utils.hexlify(o.code) : undefined,
          nonce: o.nonce ? toHexNumber(o.nonce) : undefined,
          balance: o.balance ? toHexNumber(o.balance) : undefined,
          state: o.state ? o.state : undefined,
          stateDiff: o.stateDiff ? o.stateDiff : undefined
          }
      }
    }, {}) : {}

    const overwrites = { ...providedOverwrites, 
      [from]: {
        code: GasEstimator.deployedBytecode
      }
    }

    const response = await this.provider.send("eth_call", [{
      to: from,
      data: encodedEstimate,
      gasPrice: args.gasPrice,
      gas: args.gas,
    }, blockTag, overwrites])

    const decoded = gasEstimatorInterface.decodeFunctionResult("estimate", response)
    return ethers.BigNumber.from(decoded.gas).add(txBaseCost(data))
  }
}
