import { access, constants, stat } from 'node:fs/promises';
import { registry as playwrightRegistry } from 'playwright-core/lib/coreBundle';

export const BROWSER_INSTALL_COMMAND =
  'npm exec --no -- playwright install chromium';

export async function screenshotCapability({
  executable = process.env.LOCADE_BROWSER_EXECUTABLE ||
    playwrightRegistry.registry
      .findExecutable('chromium-headless-shell')
      ?.executablePath(),
  check = async (file) => {
    await access(file, constants.X_OK);
    if (!(await stat(file)).isFile()) throw new Error('Not a browser file');
  },
} = {}) {
  try {
    if (!executable)
      return {
        state: 'unknown',
        verifiedLaunch: false,
        installCommand: BROWSER_INSTALL_COMMAND,
      };
    await check(executable);
    return {
      state: 'available',
      verifiedLaunch: false,
      installCommand: BROWSER_INSTALL_COMMAND,
    };
  } catch (error) {
    return {
      state: error.code === 'ENOENT' ? 'missing' : 'unknown',
      verifiedLaunch: false,
      installCommand: BROWSER_INSTALL_COMMAND,
    };
  }
}
