import { expect } from "chai"
import { MemoryItemStore, OpenWalletIntent, ProviderEventTypes, ProviderTransport, SequenceClient, TypedEventEmitter } from "../src"
import { JsonRpcRequest, JsonRpcResponse, JsonRpcResponseCallback, allNetworks } from "@0xsequence/network"
import EventEmitter from "events"
import { commons, v1, v2 } from "@0xsequence/core"
import { ethers } from "ethers"
import { TypedData } from "@0xsequence/utils"
import { ExtendedTransactionRequest } from "../src/extended"

const basicMockTransport = {
  on: () => {}
} as unknown as ProviderTransport

const sampleContext = {
  [1]: {
    version: 1,
    factory: '0x1234',
    mainModule: '0x5678',
    mainModuleUpgradable: '0x213123',
    guestModule: '0x634123',
  
    walletCreationCode: '0x112233',
  },
  [4]: {
    version: 4,
    factory: '0x99283',
    mainModule: '0x1234',
    mainModuleUpgradable: '0x5678',
    guestModule: '0x213123',

    walletCreationCode: '0x112233',
  }
} as commons.context.VersionedContext

describe('SequenceClient', () => {
  describe('callbacks', () => {
    let callbacks: TypedEventEmitter<ProviderEventTypes> = new EventEmitter() as TypedEventEmitter<ProviderEventTypes>
    let client: SequenceClient

    beforeEach(() => {
      const mockTransport = {
        on<K extends keyof ProviderEventTypes>(event: K, fn: ProviderEventTypes[K]): void {
          callbacks.on(event, fn)
        }
      }

      client = new SequenceClient(mockTransport as unknown as ProviderTransport, new MemoryItemStore(), 1)
    })

    it('shoud emit open event', async () => {
      let called = false

      client.onOpen(() => {
        called = true
      })

      callbacks.emit('open', {})
      expect(called).to.be.true
    })

    it('should emit networks event', async () => {
      let called = false

      client.onNetworks((networks) => {
        expect(networks).to.deep.equal(allNetworks)
        called = true
      })

      callbacks.emit('networks', JSON.parse(JSON.stringify(allNetworks)))
      expect(called).to.be.true
    })

    it('should emit accounts changed event', async () => {
      let called = false

      client.onAccountsChanged((accounts) => {
        expect(accounts).to.deep.equal(['0x1234', '0x5678'])
        called = true
      })

      callbacks.emit('accountsChanged', ['0x1234', '0x5678'])
      expect(called).to.be.true
    })

    it('should emit wallet context event', async () => {
      let called = false

      client.onWalletContext((context) => {
        expect(context).to.deep.equal(sampleContext)
        called = true
      })

      callbacks.emit('walletContext', sampleContext)
      expect(called).to.be.true
    })

    it('should emit default chain id changed event', async () => {
      // NOTICE: This is not handled by the transport
      // this is because network switching is done client-side
      // and transport is never aware of it.
      let calls = 0

      client.onDefaultChainIdChanged((chainId) => {
        expect(chainId).to.equal(calls === 0 ? 2 : 1)
        calls++
      })

      client.setDefaultChainId(2)
      client.setDefaultChainId(1)
      // Second call should not trigger event
      client.setDefaultChainId(1)

      expect(calls).to.equal(2)
    })

    it('should emit close event', async () => {
      let called = false

      client.onClose(() => {
        called = true
      })

      callbacks.emit('close')
      expect(called).to.be.true
    })

    it('should unregister callback', async () => {
      let called = false

      const unregister = client.onClose(() => {
        called = true
      })

      unregister()

      callbacks.emit('close')
      expect(called).to.be.false
    })
  })

  it('should open wallet', async () => {
    let calledOpenWallet = 0
    let calledWaitUntilOpened = 0
    let calledIsOpened = 0

    const path = 'this/is/a/test/path'
    const intent = {
      type: 'connect'
    } as OpenWalletIntent

    const client = new SequenceClient(
      {
        ...basicMockTransport,
        openWallet: (path: string, intent: OpenWalletIntent) => {
          calledOpenWallet++
          expect(path).to.equal(path)
          expect(intent).to.equal(intent)
          return Promise.resolve(true)
        },
        waitUntilOpened: async () => {
          calledWaitUntilOpened++
          // delay a bit
          await new Promise((resolve) => setTimeout(resolve, 500))
          return {
            accountAddress: ethers.Wallet.createRandom().address
          }
        },
        isOpened: () => {
          calledIsOpened++
          return false
        }
      },
      new MemoryItemStore(),
      2
    )

    const result = await client.openWallet(path, intent)
    expect(result).to.equal(false)
    expect(calledOpenWallet).to.equal(1)
    expect(calledWaitUntilOpened).to.equal(1)
    expect(calledIsOpened).to.equal(1)
  })

  it('should close wallet', async () => {
    let calledCloseWallet = 0

    const client = new SequenceClient(
      {
        ...basicMockTransport,
        closeWallet: () => {
          calledCloseWallet++
        },
      },
      new MemoryItemStore(),
      2
    )

    client.closeWallet()
    expect(calledCloseWallet).to.equal(1)
  })

  it('should handle isOpened', async () => {
    let calledIsOpened = 0

    const client = new SequenceClient(
      {
        ...basicMockTransport,
        isOpened: () => {
          calledIsOpened++
          return calledIsOpened === 1
        },
      },
      new MemoryItemStore(),
      2
    )

    const result1 = client.isOpened()
    expect(result1).to.equal(true)
    expect(calledIsOpened).to.equal(1)

    const result2 = client.isOpened()
    expect(result2).to.equal(false)
    expect(calledIsOpened).to.equal(2)
  })

  it('should handle connect, isConnected and disconnect', async () => {
    let calledIsOpened = 0
    let calledOpenWallet = 0
    let calledCloseWallet = 0
    let calledWaitUntilOpened = 0
    let calledWaitUntilConnected = 0

    const session = {
      accountAddress: ethers.Wallet.createRandom().address
    }

    const client = new SequenceClient(
      {
        ...basicMockTransport,
        openWallet: (path?: string, intent?: OpenWalletIntent) => {
          expect(path).to.equal(undefined)
          expect(intent).to.deep.equal({
            type: 'connect',
            options: {
              app: 'This is a test',
              authorizeVersion: 2
            }
          })

          calledOpenWallet++
          return Promise.resolve(true)
        },
        waitUntilOpened: async () => {
          calledWaitUntilOpened++
          return session
        },
        waitUntilConnected: async () => {
          calledWaitUntilConnected++
          return { connected: true, session }
        },
        isOpened: () => {
          calledIsOpened++
          return true
        },
        closeWallet: () => {
          calledCloseWallet++
        }
      },
      new MemoryItemStore(),
      2
    )

    const result1 = client.isConnected()
    expect(result1).to.equal(false)

    const result2 = await client.connect({ app: 'This is a test' })
    expect(result2.connected).to.equal(true)
    expect(result2.session).to.equal(session)

    const result3 = client.isConnected()
    expect(result3).to.equal(true)

    await client.disconnect()

    const result4 = client.isConnected()
    expect(result4).to.equal(false)

    expect(calledIsOpened).to.equal(2, 'isOpened')
    expect(calledOpenWallet).to.equal(1, 'openWallet')
    expect(calledWaitUntilOpened).to.equal(1, 'waitUntilOpened')
    expect(calledWaitUntilConnected).to.equal(1, 'waitUntilConnected')
    expect(calledCloseWallet).to.equal(1, 'closeWallet')
  })

  it('should handle fail to connect', async () => {
    const client = new SequenceClient(
      {
        ...basicMockTransport,
        openWallet: () => Promise.resolve(true),
        waitUntilOpened: async () => {
          return {
            accountAddress: ethers.Wallet.createRandom().address
          }
        },
        waitUntilConnected: async () => {
          throw new Error('Failed to connect')
        },
        isOpened: () => true,
      },
      new MemoryItemStore(),
      2
    )

    const result = await client.connect({ app: 'This is a test' })
    expect(result.connected).to.equal(false)
    expect(result.session).to.equal(undefined)
    expect(result.error).to.equal('Failed to connect')
    expect(client.isConnected()).to.equal(false)
  })

  it('should handle reject connect', async () => {
    const client = new SequenceClient(
      {
        ...basicMockTransport,
        openWallet: () => Promise.resolve(true),
        waitUntilOpened: async () => {
          return {
            accountAddress: ethers.Wallet.createRandom().address
          }
        },
        waitUntilConnected: async () => {
          return { connected: false }
        },
        isOpened: () => true,
      },
      new MemoryItemStore(),
      2
    )

    const result = await client.connect({ app: 'This is a test' })
    expect(result.connected).to.equal(false)
    expect(result.session).to.equal(undefined)
    expect(result.error).to.equal(undefined)
    expect(client.isConnected()).to.equal(false)
  })

  it('should handle arbitrary send', async () => {
    let calledSendAsync = 0

    const commands = [
      { chainId: 2, req: { method: 'eth_chainId', params: [] }, res: { result: '0x01' } },
      { chainId: 2, req: { method: 'eth_accounts', params: [] }, res: { result: '0x12345' } },
      { chainId: 5, req: { method: 'eth_sendTransaction', params: [{ to: '0x1234' }] }, res: { result: '0x000' } },
      { chainId: 9, req: { method: 'non-standard', params: [{ a: 23123, b: true }] }, res: { result: '0x99' } }
    ] as { chainId: number, req: JsonRpcRequest, res: JsonRpcResponse }[]

    const client = new SequenceClient(
      {
        ...basicMockTransport,
        sendAsync: (request: JsonRpcRequest, callback: JsonRpcResponseCallback, chainId?: number) => {
          calledSendAsync++
          const command = commands.shift()
          expect(request).to.deep.equal(command?.req)
          expect(chainId).to.equal(command?.chainId)
          callback(undefined, command?.res)
        }
      },
      new MemoryItemStore(),
      2
    )

    expect(calledSendAsync).to.equal(0)

    const result1 = await client.send({ method: 'eth_chainId', params: [] })
    expect(result1).to.deep.equal({ result: '0x01' })
    expect(calledSendAsync).to.equal(1)

    const result2 = await client.send({ method: 'eth_accounts', params: [] }, 2)
    expect(result2).to.deep.equal({ result: '0x12345' })
    expect(calledSendAsync).to.equal(2)

    const result3 = await client.send({ method: 'eth_sendTransaction', params: [{ to: '0x1234' }] }, 5)
    expect(result3).to.deep.equal({ result: '0x000' })
    expect(calledSendAsync).to.equal(3)

    // Changing the default chainId
    // should change the chainId of the request
    client.setDefaultChainId(9)

    const result4 = await client.send({ method: 'non-standard', params: [{ a: 23123, b: true }] })
    expect(result4).to.deep.equal({ result: '0x99' })
    expect(calledSendAsync).to.equal(4)
  })

  it('should handle error during arbitrary send', async () => {
    const client = new SequenceClient(
      {
        ...basicMockTransport,
        sendAsync: (request: JsonRpcRequest, callback: JsonRpcResponseCallback, chainId?: number) => {
          callback(new Error('Failed to send'))
        }
      },
      new MemoryItemStore(),
      2
    )

    const result = client.send({ method: 'eth_chainId', params: [] })
    await expect(result).to.be.rejectedWith('Failed to send')
  })

  it('should fail is response is empty', async () => {
    const client = new SequenceClient(
      {
        ...basicMockTransport,
        sendAsync: (request: JsonRpcRequest, callback: JsonRpcResponseCallback, chainId?: number) => {
          callback(undefined, undefined)
        }
      },
      new MemoryItemStore(),
      2
    )

    const request = { method: 'eth_chainId', params: [] }
    const result = client.send(request)
    await expect(result).to.be.rejectedWith(`Got undefined response for request: ${request}`)
  })

  it('shound handle getNetworks', async () => {
    // Networks are fetched once (during connect) and cached
    let calledSendAsync = 0

    const session = {
      accountAddress: ethers.Wallet.createRandom().address,
      networks: allNetworks,
      walletContext: sampleContext
    }

    const client = new SequenceClient(
      {
        ...basicMockTransport,
        sendAsync: (request: JsonRpcRequest, callback: JsonRpcResponseCallback) => {
          calledSendAsync++
          expect(request).to.deep.equal({ method: 'sequence_getNetworks' })
          callback(undefined, { result: [{
            chainId: 5,
            name: 'test'
          }] } as any)
        },
        openWallet: () => {
          return Promise.resolve(true)
        },
        waitUntilOpened: async () => {
          return session
        },
        waitUntilConnected: async () => {
          return { connected: true, session }
        },
        isOpened: () => {
          return true
        },
      },
      new MemoryItemStore(),
      2
    )

    const result1 = client.getNetworks()
    await expect(result1).to.be.rejectedWith('Sequence session not connected')

    await client.connect({ app: 'This is a test' })

    const result2 = await client.getNetworks()
    expect(result2).to.deep.equal(allNetworks)
    // We fetched this data on the connect call
    expect(calledSendAsync).to.equal(0)

    const result3 = await client.getNetworks()
    expect(result3).to.deep.equal(allNetworks)
    // We cached the data
    expect(calledSendAsync).to.equal(0)

    const result4 = await client.getNetworks(true)
    expect(result4).to.deep.equal([{
      chainId: 5,
      name: 'test'
    }])
    // We forced a fetch
    expect(calledSendAsync).to.equal(1)
  })

  it('should return address and accounts', async () => {
    const session = {
      accountAddress: ethers.Wallet.createRandom().address,
      networks: allNetworks,
      walletContext: sampleContext
    }

    const client = new SequenceClient(
      {
        ...basicMockTransport,
        openWallet: () => {
          return Promise.resolve(true)
        },
        waitUntilOpened: async () => {
          return session
        },
        waitUntilConnected: async () => {
          return { connected: true, session }
        },
        isOpened: () => {
          return true
        },
        closeWallet: () => {}
      },
      new MemoryItemStore(),
      2
    )

    const result1 = new Promise(() => client.getAddress())
    await expect(result1).to.be.rejectedWith('Sequence session not connected')

    const result2 = new Promise(() => client.getAccounts())
    await expect(result2).to.be.rejectedWith('Sequence session not connected')

    await client.connect({ app: 'This is a test' })

    const result3 = client.getAddress()
    expect(result3).to.equal(session.accountAddress)

    const result4 = client.getAccounts()
    expect(result4).to.deep.equal([session.accountAddress])

    await client.disconnect()

    const result5 = new Promise(() => client.getAddress())
    await expect(result5).to.be.rejectedWith('Sequence session not connected')

    const result6 = new Promise(() => client.getAccounts())
    await expect(result6).to.be.rejectedWith('Sequence session not connected')
  })

  it('should call sign message', async () => {
    const session = {
      accountAddress: ethers.Wallet.createRandom().address,
      networks: allNetworks,
      walletContext: sampleContext
    }

    let calledSendAsync = 0

    const requests = [
      { eip6492: false, chainId: 2, message: '0x1234', result: '0x0000' },
      { eip6492: true, chainId: 2, message: [4, 2, 9, 1], result: '0x1111' },
      { eip6492: false, chainId: 5, message: '0x9993212', result: '0x2222' },
      { eip6492: true, chainId: 6, message: [4, 2, 9, 1], result: '0x3333' },
    ] as { eip6492: boolean, chainId: number, message: ethers.BytesLike, result: string }[]

    const client = new SequenceClient(
      {
        ...basicMockTransport,
        sendAsync: (request: JsonRpcRequest, callback: JsonRpcResponseCallback, chainId?: number) => {
          calledSendAsync++
          const req = requests.shift()
          expect(request).to.deep.equal({
            method: req?.eip6492 ? 'sequence_sign' : 'personal_sign',
            params: [req?.message, session.accountAddress]
          })
          expect(chainId).to.equal(req?.chainId)
          callback(undefined, { result: req?.result } as any)
        },
        openWallet: () => {
          return Promise.resolve(true)
        },
        waitUntilOpened: async () => {
          return session
        },
        waitUntilConnected: async () => {
          return { connected: true, session }
        },
        isOpened: () => {
          return true
        },
        closeWallet: () => {}
      },
      new MemoryItemStore(),
      2
    )

    const result1 = client.signMessage('0x1234')
    await expect(result1).to.be.rejectedWith('Sequence session not connected')

    await client.connect({ app: 'This is a test' })

    const result2 = await client.signMessage('0x1234')
    expect(result2).to.equal('0x0000')

    const result3 = await client.signMessage([4, 2, 9, 1], { eip6492: true, chainId: 2 })
    expect(result3).to.equal('0x1111')

    client.setDefaultChainId(5)

    const result4 = await client.signMessage('0x9993212')
    expect(result4).to.equal('0x2222')

    const result5 = await client.signMessage([4, 2, 9, 1], { eip6492: true, chainId: 6 })
    expect(result5).to.equal('0x3333')

    expect(calledSendAsync).to.equal(4)
  })

  it('should call sign typed message', async () => {
    const session = {
      accountAddress: ethers.Wallet.createRandom().address,
      networks: allNetworks,
      walletContext: sampleContext
    }

    let calledSendAsync = 0

    const requests = [
      {
        eip6492: false,
        chainId: 2,
        data: {
          domain: {
            name: "App1",
            version: "1",
            chainId: 2,
            verifyingContract: ethers.Wallet.createRandom().address,
          },
          types: {
            Person: [
              { name: "name", type: "string" },
              { name: "age", type: "uint256" }
            ]
          },
          message: {
            name: "Alice",
            age: "28"
          }
        },
        result: '0x0000'
      },
      {
        eip6492: true,
        chainId: 2,
        data: {
          domain: {
            name: "App2",
            version: "1.1",
            chainId: 2,
            verifyingContract: ethers.Wallet.createRandom().address,
          },
          types: {
            Payment: [
              { name: "receiver", type: "address" },
              { name: "amount", type: "uint256" }
            ]
          },
          message: {
            receiver: ethers.Wallet.createRandom().address,
            amount: "100"
          }
        },
        result: '0x1111'
      },
      {
        eip6492: false,
        chainId: 5,
        data: {
          domain: {
            name: "App3",
            version: "2",
            chainId: 5,
            verifyingContract: ethers.Wallet.createRandom().address,
          },
          types: {
            Agreement: [
              { name: "firstParty", type: "address" },
              { name: "secondParty", type: "address" },
              { name: "terms", type: "string" }
            ]
          },
          message: {
            firstParty: ethers.Wallet.createRandom().address,
            secondParty: ethers.Wallet.createRandom().address,
            terms: "Terms of the agreement here."
          }
        },
        result: '0x2222'
      },
      {
        eip6492: true,
        chainId: 6,
        data: {
          domain: {
            name: "App4",
            version: "2.1",
            chainId: 7, // This is ignored because option takes precedence
            verifyingContract: ethers.Wallet.createRandom().address,
          },
          types: {
            Sale: [
              { name: "item", type: "string" },
              { name: "price", type: "uint256" }
            ]
          },
          message: {
            item: "Laptop",
            price: "1500"
          }
        },
        result: '0x3333'
      },
      {
        eip6492: true,
        chainId: 99,
        data: {
          domain: {
            name: "App4",
            version: "2.1",
            chainId: 99,
            verifyingContract: ethers.Wallet.createRandom().address,
          },
          types: {
            Sale: [
              { name: "item", type: "string" },
              { name: "price", type: "uint256" }
            ]
          },
          message: {
            item: "Laptop",
            price: "1500"
          }
        },
        result: '0x5555'
      }
    ] as { eip6492: boolean, chainId: number, data: TypedData, result: string }[]    

    const client = new SequenceClient(
      {
        ...basicMockTransport,
        sendAsync: (request: JsonRpcRequest, callback: JsonRpcResponseCallback, chainId?: number) => {
          const req = requests[calledSendAsync]
          calledSendAsync++

          const encoded =  ethers.utils._TypedDataEncoder.getPayload(req!.data.domain, req!.data.types, req!.data.message)

          expect(request).to.deep.equal({
            method: req?.eip6492 ? 'sequence_signTypedData_v4' : 'eth_signTypedData_v4',
            params: [session.accountAddress, encoded]
          })

          expect(chainId).to.equal(req?.chainId)
          callback(undefined, { result: req?.result } as any)
        },
        openWallet: () => {
          return Promise.resolve(true)
        },
        waitUntilOpened: async () => {
          return session
        },
        waitUntilConnected: async () => {
          return { connected: true, session }
        },
        isOpened: () => {
          return true
        },
        closeWallet: () => {}
      },
      new MemoryItemStore(),
      2
    )

    const result1 = client.signTypedData(requests[0].data)
    await expect(result1).to.be.rejectedWith('Sequence session not connected')

    await client.connect({ app: 'This is a test' })

    const result2 = await client.signTypedData(requests[0].data)
    expect(result2).to.equal('0x0000')

    const result3 = await client.signTypedData(requests[1].data, { eip6492: true, chainId: 2 })
    expect(result3).to.equal('0x1111')

    client.setDefaultChainId(5)

    const result4 = await client.signTypedData(requests[2].data)
    expect(result4).to.equal('0x2222')

    const result5 = await client.signTypedData(requests[3].data, { eip6492: true, chainId: 6 })
    expect(result5).to.equal('0x3333')

    expect(calledSendAsync).to.equal(4)

    // Should use chainId provided by typed data
    const result6 = await client.signTypedData(requests[4].data, { eip6492: true })
    expect(result6).to.equal('0x5555')
  })

  it('should call send transaction', async () => {
    let calledSendAsync = 0

    const requests = [
      { chainId: 2, tx: {
        to: '0x88E1627e95071d140Abaec34574ee4AC991295fC',
        value: ethers.utils.parseEther('1.0'),
        auxiliary: [],
      }, result: '0x0000' },
      { chainId: 2, tx: {
        to: '0xD20bC67fD6feFad616Ed6B29d6d15884E08b6D86',
        value: 0,
        gasLimit: 90000,
        data: '0x8fe62083b9bc53178597a5a6bf55a565f1889b177607a3713bd1299aa2d4eac5458b279c87b7f85eb4e8',
        auxiliary: [],
      }, result: '0x1111' },
      { chainId: 5, tx: {
        to: '0xf0B654137245894CAb26e56230403651B053D2Dd',
        auxiliary: [],
      }, result: '0x2222' },
      { chainId: 6, tx: {
        to: '0x88E1627e95071d140Abaec34574ee4AC991295fC',
        value: ethers.utils.parseEther('1.0'),
        auxiliary: [{
          to: '0xD20bC67fD6feFad616Ed6B29d6d15884E08b6D86',
          data: '0xefc57b05025168af33d34948ddbad8bd32a2eb8857468aa492ef94de07451c4b3423080f028edebab979',
        }, {
          to: '0xf0B654137245894CAb26e56230403651B053D2Dd',
          value: 1,
        }],
      }, result: '0x3333' },
    ] as { chainId: number, tx: ExtendedTransactionRequest, result: string }[]

    const client = new SequenceClient(
      {
        ...basicMockTransport,
        sendAsync: (request: JsonRpcRequest, callback: JsonRpcResponseCallback, chainId?: number) => {
          calledSendAsync++
          const req = requests.shift()
          expect(request).to.deep.equal({
            method: 'eth_sendTransaction',
            params: [req?.tx]
          })
          expect(chainId).to.equal(req?.chainId)
          callback(undefined, { result: req?.result } as any)
        }
      },
      new MemoryItemStore(),
      2
    )

    // NOTICE: eth_sendTransaction doesn't require the address, so we don't attempt
    // to get the address, thus we don't need to connect to the wallet
    // we could add an extra check, but better to avoid client-side access control
    // and let the wallet handle it, so we don't have a false sense of security.
    //
    // const result1 = client.sendTransaction({
    //   to: '0x88E1627e95071d140Abaec34574ee4AC991295fC',
    //   value: ethers.utils.parseEther('1.0'),
    // })

    // await expect(result1).to.be.rejectedWith('Sequence session not connected')
    // await client.connect({ app: 'This is a test' })

    const result2 = await client.sendTransaction({
      to: '0x88E1627e95071d140Abaec34574ee4AC991295fC',
      value: ethers.utils.parseEther('1.0'),
    })
  
    expect(result2).to.equal('0x0000')

    const result3 = await client.sendTransaction({
      to: '0xD20bC67fD6feFad616Ed6B29d6d15884E08b6D86',
      value: 0,
      data: '0x8fe62083b9bc53178597a5a6bf55a565f1889b177607a3713bd1299aa2d4eac5458b279c87b7f85eb4e8',
      gasLimit: 90000,
    }, { chainId: 2 })

    expect(result3).to.equal('0x1111')

    client.setDefaultChainId(5)

    const result4 = await client.sendTransaction({
      to: '0xf0B654137245894CAb26e56230403651B053D2Dd'
    })

    expect(result4).to.equal('0x2222')

    const result5 = await client.sendTransaction([{
      to: '0x88E1627e95071d140Abaec34574ee4AC991295fC',
      value: ethers.utils.parseEther('1.0'),
    }, {
      to: '0xD20bC67fD6feFad616Ed6B29d6d15884E08b6D86',
      data: '0xefc57b05025168af33d34948ddbad8bd32a2eb8857468aa492ef94de07451c4b3423080f028edebab979'
    }, {
      to: '0xf0B654137245894CAb26e56230403651B053D2Dd',
      value: 1,
    }], { chainId: 6 })

    expect(result5).to.equal('0x3333')

    expect(calledSendAsync).to.equal(4)
  })

  it('should call getWalletContext', async () => {
    let calledSendAsync = 0

    const client = new SequenceClient(
      {
        ...basicMockTransport,
        sendAsync: (request: JsonRpcRequest, callback: JsonRpcResponseCallback, chainId?: number) => {
          calledSendAsync++
          expect(request).to.deep.equal({
            method: 'sequence_getWalletContext'
          })
          callback(undefined, { result: sampleContext } as any)
        }
      },
      new MemoryItemStore(),
      2
    )

    const result = await client.getWalletContext()
    expect(result).to.deep.equal(sampleContext)
    expect(calledSendAsync).to.equal(1)
  })

  it('should call getOnchainWalletConfig', async () => {
    let calledSendAsync = 0

    const results = [
      {
        chainId: 2, result: v2.config.ConfigCoder.fromSimple({
          threshold: 2, checkpoint: 0, signers: [
            { weight: 1, address: ethers.Wallet.createRandom().address },
            { weight: 1, address: ethers.Wallet.createRandom().address },
          ]
        })
      }, {
        chainId: 2, result: v2.config.ConfigCoder.fromSimple({
          threshold: 1, checkpoint: 10, signers: [
            { weight: 1, address: ethers.Wallet.createRandom().address },
          ]
        })
      }, {
        chainId: 5, result: v1.config.ConfigCoder.fromSimple({
          threshold: 1, checkpoint: 0, signers: [
            { weight: 3, address: ethers.Wallet.createRandom().address },
            { weight: 2, address: ethers.Wallet.createRandom().address },
            { weight: 3, address: ethers.Wallet.createRandom().address },
          ]
        })
      }, {
        chainId: 6, result: v1.config.ConfigCoder.fromSimple({
          threshold: 1, checkpoint: 0, signers: [
            { weight: 1, address: ethers.Wallet.createRandom().address },
          ]
        })
      }
    ] as { chainId: number, result: commons.config.Config }[]

    const client = new SequenceClient(
      {
        ...basicMockTransport,
        sendAsync: (request: JsonRpcRequest, callback: JsonRpcResponseCallback, chainId?: number) => {
          const req = results[calledSendAsync]
          calledSendAsync++
          expect(request).to.deep.equal({
            method: 'sequence_getWalletConfig'
          })
          expect(chainId).to.equal(req?.chainId)
          callback(undefined, { result: req?.result } as any)
        }
      },
      new MemoryItemStore(),
      2
    )

    // NOTICE: sequence_getWalletConfig doesn't require the address, so we don't attempt
    // to get the address, thus we don't need to connect to the wallet
    // we could add an extra check, but better to avoid client-side access control
    // and let the wallet handle it, so we don't have a false sense of security.

    const result1 = await client.getOnchainWalletConfig()
    expect(result1).to.deep.equal(results[0].result)

    const result2 = await client.getOnchainWalletConfig({ chainId: 2 })
    expect(result2).to.deep.equal(results[1].result)

    client.setDefaultChainId(5)

    const result3 = await client.getOnchainWalletConfig()
    expect(result3).to.deep.equal(results[2].result)

    const result4 = await client.getOnchainWalletConfig({ chainId: 6 })
    expect(result4).to.deep.equal(results[3].result)
  })
})
