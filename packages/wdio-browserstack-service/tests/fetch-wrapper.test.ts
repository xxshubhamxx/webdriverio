import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fetchWrap, { ResponseError } from '../src/fetchWrapper.js'
import { ProxyAgent } from 'undici'

global.fetch = vi.fn()

vi.mock('undici', () => ({
    ProxyAgent: vi.fn()
}))

describe('fetchWrap', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    afterEach(() => {
        delete process.env.HTTP_PROXY
        delete process.env.HTTPS_PROXY
    })

    it('should call fetch without proxy', async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response('ok', { status: 200 }))

        const response = await fetchWrap('http://example.com')

        expect(global.fetch).toHaveBeenCalledWith('http://example.com', {})
        expect(response.ok).toBe(true)
    })

    it('should call fetch with proxy agent', async () => {
        process.env.HTTP_PROXY = 'http://proxy.com'
        const proxyAgent = new ProxyAgent(process.env.HTTP_PROXY)
        ;(ProxyAgent as unknown as ReturnType<typeof vi.fn>).mockReturnValue(proxyAgent)
        ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response('ok', { status: 200 }))

        const response = await fetchWrap('http://example.com')

        expect(global.fetch).toHaveBeenCalledWith('http://example.com', { agent: proxyAgent })
        expect(response.ok).toBe(true)
    })

    it('should throw ResponseError on non-ok response', async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response('error', { status: 500 }))

        await expect(fetchWrap('http://example.com')).rejects.toThrow(ResponseError)
    })
})