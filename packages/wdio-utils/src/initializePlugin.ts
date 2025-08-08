import type { Services } from '@wdio/types'

import { safeImport, isAbsolute, REG_EXP_WINDOWS_ABS_PATH, SLASH } from './utils.js'

const FILE_PROTOCOL = 'file://'

export default async function initializePlugin (name: string, type?: string): Promise<Services.ServicePlugin | Services.RunnerPlugin> {
    // direct import for scoped or absolute path
    if (name[0] === '@' || isAbsolute(name)) {
        const fileUrl = name[0] === '@' ? name : ensureFileURL(name)
        const service = await safeImport(fileUrl)
        if (service) {
            return service
        }
    }

    if (typeof type !== 'string') {
        throw new Error('No plugin type provided')
    }

    if (
        name.toLowerCase() === 'browserstack' ||
        name.toLowerCase() === 'browserstack-service' ||
        name.toLowerCase() === '@wdio/browserstack-service'
    ) {
        const bsIntegration = await safeImport('browserstack-webdriverio-integration')
        if (bsIntegration) {
            return bsIntegration
        }
    }

    // check for scoped version of plugin first
    const scopedPlugin = await safeImport(`@wdio/${name.toLowerCase()}-${type}`)
    if (scopedPlugin) {
        return scopedPlugin
    }

    // check for old type
    const plugin = await safeImport(`wdio-${name.toLowerCase()}-${type}`)
    if (plugin) {
        return plugin
    }

    throw new Error(
        `Couldn't find plugin "${name}" ${type}, neither as wdio scoped package `+
        `"@wdio/${name.toLowerCase()}-${type}" nor as community package ` +
        `"wdio-${name.toLowerCase()}-${type}". Please make sure you have it installed!`
    )
}

function ensureFileURL(path: string) {
    if (path.startsWith(FILE_PROTOCOL)) {
        return path
    }
    if (REG_EXP_WINDOWS_ABS_PATH.test(path)) {
        return `${FILE_PROTOCOL}/${path.replace(/\\/g, '/')}`
    }
    if (path.startsWith(SLASH)) {
        return `${FILE_PROTOCOL}${path}`
    }
    return path
}
