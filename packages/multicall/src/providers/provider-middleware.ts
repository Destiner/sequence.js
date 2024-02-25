import { Multicall, MulticallOptions } from '../multicall'
import { JsonRpcRequest, JsonRpcResponseCallback, EIP1193ProviderFunc, JsonRpcMiddleware } from '@0xsequence/network'

// NOTE: we don't need this thing at all..??

export const multicallMiddleware =
  (multicall?: Multicall | Partial<MulticallOptions>): JsonRpcMiddleware =>
    (next: EIP1193ProviderFunc) => {
      return async (request: { jsonrpc: '2.0', id?: number, method: string, params?: any[], chainId?: number }): Promise<any> => {

        // TODO ... lets just do our batching here...?

        const lib = Multicall.isMulticall(multicall) ? multicall : new Multicall(multicall!)
        return lib.requestHandler(next)
      }
    }
      // const lib = Multicall.isMulticall(multicall) ? multicall : new Multicall(multicall!)
      // return (request: JsonRpcRequest, callback: JsonRpcResponseCallback) => {
      //   return lib.handle(next, request, callback)
      // }


/*
export const multicallMiddleware =
  (multicall?: Multicall | Partial<MulticallOptions>): JsonRpcMiddleware =>
    (next: EIP1193ProviderFunc) => {
      const lib = Multicall.isMulticall(multicall) ? multicall : new Multicall(multicall!)
      return (request: JsonRpcRequest, callback: JsonRpcResponseCallback) => {
        return lib.handle(next, request, callback)
      }

*/
