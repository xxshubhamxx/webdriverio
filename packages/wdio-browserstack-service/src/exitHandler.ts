import { spawn } from 'node:child_process'
import path from 'node:path'
import BrowserStackConfig from './config.js'
import { saveFunnelData } from './instrumentation/funnelInstrumentation.js'
import { fileURLToPath } from 'node:url'
import { BROWSERSTACK_TESTHUB_JWT } from './constants.js'
import PerformanceTester from './instrumentation/performance/performance-tester.js'
import TestOpsConfig from './testOps/testOpsConfig.js'
import { BStackLogger } from './bstackLogger.js'
import { BrowserstackCLI } from './cli/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Module-level guard so cleanup runs at most once, regardless of how many
// termination paths fire (exit / signals / errors can overlap). SDK-5981.
let cleanupHasRun = false

function runExitCleanup() {
    if (cleanupHasRun) {
        return
    }
    cleanupHasRun = true

    const isCLIEnabled = BrowserstackCLI.getInstance().isRunning()
    handleCLICleanup()
    const args = shouldCallCleanup(BrowserStackConfig.getInstance(), isCLIEnabled)
    if (Array.isArray(args) && args.length) {
        BStackLogger.debug(`Spawning cleanup.js with args: ${args.join(', ')}`)
        const childProcess = spawn('node', [`${path.join(__dirname, 'cleanup.js')}`, ...args], { detached: true, stdio: 'inherit', env: { ...process.env } })
        childProcess.unref()
    }
}

function handleCLICleanup() {
    BStackLogger.debug('Handling CLI cleanup in exit handler')
    try {
        const cliProcess = BrowserstackCLI.getInstance()?.process

        if (cliProcess && cliProcess.pid && cliProcess.exitCode === null) {
            BStackLogger.debug(`Found CLI process with PID ${cliProcess.pid}, terminating`)
            try {
                if (process.platform === 'win32') {
                    cliProcess.kill('SIGTERM')
                    BStackLogger.debug('CLI process terminated successfully with SIGTERM (Windows)')
                } else {
                    cliProcess.kill('SIGINT')
                    BStackLogger.debug('CLI process terminated successfully with SIGINT (Unix)')
                }
            } catch (processError) {
                BStackLogger.debug(`CLI process termination error: ${processError}`)
                try {
                    cliProcess.kill()
                    BStackLogger.debug('CLI process terminated with default signal (fallback)')
                } catch (fallbackError) {
                    BStackLogger.debug(`CLI process fallback termination error: ${fallbackError}`)
                }
            }
        } else {
            BStackLogger.debug('No CLI process found to terminate')
        }
    } catch (error) {
        BStackLogger.debug(`Error in CLI cleanup: ${error}`)
    }
}

export function setupExitHandlers() {
    // 'exit' cannot perform async work, but the detached cleanup.js spawn
    // survives the parent exiting, so build-stop still completes.
    process.on('exit', () => {
        runExitCleanup()
    })

    // Signal kills (e.g. CI sending SIGTERM/SIGINT to a hung run) never reach
    // the 'exit' handler on their own, leaving the Observability build open
    // until a server-side watchdog closes it hours later. Run the same
    // cleanup, then re-exit with the conventional code so we don't swallow the
    // signal. The detached cleanup.js handles the async build-stop. SDK-5981.
    const handleSignal = (signal: NodeJS.Signals, exitCode: number) => {
        BStackLogger.debug(`Received ${signal}, running BrowserStack exit cleanup`)
        try {
            runExitCleanup()
        } catch (error) {
            BStackLogger.debug(`Error during ${signal} cleanup: ${error}`)
        }
        process.exit(exitCode)
    }
    process.on('SIGINT', () => handleSignal('SIGINT', 130))
    process.on('SIGTERM', () => handleSignal('SIGTERM', 143))

    // Crashes that would otherwise tear the process down without an 'exit'
    // event still need the build closed. Run cleanup, then preserve the
    // default fatal-error behaviour by re-exiting non-zero. SDK-5981.
    process.on('uncaughtException', (error) => {
        BStackLogger.debug(`uncaughtException, running BrowserStack exit cleanup: ${error}`)
        try {
            runExitCleanup()
        } catch (cleanupError) {
            BStackLogger.debug(`Error during uncaughtException cleanup: ${cleanupError}`)
        }
        process.exit(1)
    })

    process.on('unhandledRejection', (reason) => {
        BStackLogger.debug(`unhandledRejection, running BrowserStack exit cleanup: ${reason}`)
        try {
            runExitCleanup()
        } catch (cleanupError) {
            BStackLogger.debug(`Error during unhandledRejection cleanup: ${cleanupError}`)
        }
    })

    // beforeExit fires when the event loop empties without an explicit exit.
    // It runs in the normal flow, so cleanup (guarded as idempotent) is safe
    // here too. SDK-5981.
    process.on('beforeExit', () => {
        runExitCleanup()
    })
}

export function shouldCallCleanup(config: BrowserStackConfig, isCLIEnabled = false): string[] {
    const args: string[] = []
    if (!!process.env[BROWSERSTACK_TESTHUB_JWT] && !config.testObservability.buildStopped) {
        args.push('--observability')
    }

    if (config.userName && config.accessKey && !config.funnelDataSent) {
        const savedFilePath = saveFunnelData('SDKTestSuccessful', config, isCLIEnabled)
        args.push('--funnelData', savedFilePath)
    }

    if (PerformanceTester.isEnabled()) {
        process.env.PERF_USER_NAME = config.userName
        process.env.PERF_TESTHUB_UUID = TestOpsConfig.getInstance().buildHashedId
        process.env.SDK_RUN_ID = config.sdkRunID
        args.push('--performanceData')
    }

    return args
}
