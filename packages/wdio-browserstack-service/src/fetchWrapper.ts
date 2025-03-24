import type { URL } from 'node:url'
import type { Agent } from 'node:http'

import { ProxyAgent } from 'undici'

export class ResponseError extends Error {
    public response: Response
    constructor(message: string, res: Response) {
        super(message)
        this.response = res
    }
}

export default async function fetchWrap(input: RequestInfo | URL, init?: RequestInit) {
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY
    const agent = proxyUrl ? new ProxyAgent(proxyUrl) : undefined

    const updatedInit = {
        ...(init || {}),
        agent,
    } as RequestInit & { agent?: Agent }

    const res = await fetch(input, updatedInit)
    if (!res.ok) {
        throw new ResponseError(`Error response from server ${res.status}: ${await res.text()}`, res)
    }
    return res
}
