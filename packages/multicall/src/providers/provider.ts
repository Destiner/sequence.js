import { ethers } from 'ethers'
import { Multicall, MulticallOptions, batchableJsonRpcMethods } from '../multicall'
import { EIP1193Provider, JsonRpcSender } from '@0xsequence/network'

export const ProxyMethods = [
  'getNetwork',
  'getBlockNumber',
  'getFeeData',
  'getTransactionCount',
  'getStorage',
  'sendTransaction',
  'estimateGas',
  'getBlock',
  'getTransaction',
  'getTransactionReceipt',
  'getLogs',
  'emit',
  'litenerCount',
  'addListener',
  'removeListener',
  'waitForTransaction',
  'detectNetwork',
  'getBlockWithTransactions'
]

export class MulticallProvider extends ethers.AbstractProvider implements EIP1193Provider, JsonRpcSender {
  private multicall: Multicall

  constructor(
    provider: ethers.Provider,// | EIP1193Provider,
    multicall?: Multicall | Partial<MulticallOptions>,
    network?: ethers.Networkish,
  ) {
    super(network)

    this.listenerCount = provider.listenerCount.bind(provider)
    this.multicall = Multicall.isMulticall(multicall) ? multicall : new Multicall(multicall)

    ProxyMethods.forEach(m => {
      if ((provider as any)[m] !== undefined) {
        ;(this as any)[m] = (...args: any) => (provider as any)[m](...args)
      }
    })
  }

  getResolver = async (name: string | Promise<string>) => {
    const provider = this.provider as ethers.AbstractProvider

    if (provider.getResolver) {
      const ogResolver = await provider.getResolver(await name)
      if (!ogResolver) return null
      return new ethers.EnsResolver(this as any, ogResolver.address, ogResolver.name)
    }

    return provider.getResolver(await name)
  }


  request(request: { id?: number, method: string, params?: any[], chainId?: number }): Promise<any> {
    if (batchableJsonRpcMethods.includes(request.method)) {
      return this.multicall.request(request)
    } else {
      return this.provider.request(request)
    }

    // switch (request.method) {
    //   case JsonRpcMethod.ethCall:
    //     return this.multicall.request(request)
    //     return this.provider.call(request.params![0], request.params![1])

    //   case JsonRpcMethod.ethGetCode:
    //     return this.provider.getCode(request.params![0], request.params![1])
    //     // this.callback(req, callback, await this.provider.getCode(req.params![0], req.params![1]))
    //     // break

    //   case JsonRpcMethod.ethGetBalance:
    //     return this.provider.getBalance(request.params![0], request.params![1])
    //     // this.callback(req, callback, await this.provider.getBalance(req.params![0], req.params![1]))
    //     // break
    //   default:
    //     // don't use the middleware.. just call the provider directly
    //     return this.provider.request(request)
    // }
  }

  send(method: string, params?: any[], chainId?: number): Promise<any> {
    return this.request({ method, params, chainId })
  }

  // next0 = async (req: JsonRpcRequest, callback: JsonRpcResponseCallback) => {
  //   try {
  //     switch (req.method) {
  //       case JsonRpcMethod.ethCall:
  //         this.callback(req, callback, await this.provider.call(req.params![0], req.params![1]))
  //         break

  //       case JsonRpcMethod.ethGetCode:
  //         this.callback(req, callback, await this.provider.getCode(req.params![0], req.params![1]))
  //         break

  //       case JsonRpcMethod.ethGetBalance:
  //         this.callback(req, callback, await this.provider.getBalance(req.params![0], req.params![1]))
  //         break
  //     }
  //   } catch (e) {
  //     this.callback(req, callback, undefined, e)
  //   }
  // }

  // TODO/XXX: this method is useless.
  // private callback(req: JsonRpcRequest, callback: JsonRpcResponseCallback, resp: any, err?: any) {
  //   callback(err, {
  //     jsonrpc: '2.0',
  //     id: req.id!,
  //     result: resp,
  //     error: err
  //   })
  // }

  async call(
    transaction: ethers.TransactionRequest,
    blockTag?: string | number | Promise<ethers.BlockTag>
  ): Promise<string> {
    return this.request({ method: 'eth_call', params: [transaction, blockTag] })
  }

  async getCode(addressOrName: string | Promise<string>, blockTag?: ethers.BlockTag): Promise<string> {
    return this.request({ method: 'eth_getCode', params: [addressOrName, blockTag] })
  }

  async getBalance(
    addressOrName: string | Promise<string>,
    blockTag?: ethers.BlockTag
  ): Promise<bigint> {
    return this.request({ method: 'eth_getBalance', params: [addressOrName, blockTag] })
  }

  // async rpcCall(method: string, ...params: any[]): Promise<any> {
  //   const reqId = getRandomInt()
  //   const resp = await promisify(this.multicall.handle)(this.next, {
  //     jsonrpc: '2.0',
  //     id: reqId,
  //     method: method,
  //     params: params
  //   })
  //   return resp!.result
  // }
}
