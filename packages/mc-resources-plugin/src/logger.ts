import chalk from 'chalk';
import manifest from '../package.json';
import type { PluginOptions } from './types';
import { CONFIG } from './env';

const PREFIX = chalk.cyan(`[mc-resources-plugin ${manifest.version}]`) + ' ';

let logLevel = CONFIG.LOG_LEVEL;

const logger = {
  setLogLevel: (level: PluginOptions['logLevel']) => {
    logLevel = level === undefined ? CONFIG.LOG_LEVEL : level;
  },
  info: (message: string) => {
    if (logLevel === 'error') return;
    console.log(PREFIX + message);
  },
  warn: (message: string) => {
    console.warn(PREFIX + chalk.bgRed("WARN") + " " + message);
  },
  debug: (message: string) => {
    if (logLevel === 'debug') {
      console.debug(PREFIX + chalk.bgBlue("DEBUG") + " " + message);
    }
  },
  error: (message: string) => {
    console.error(PREFIX + chalk.bgRed("ERROR") + " " + message);
  },
};

export default logger;
