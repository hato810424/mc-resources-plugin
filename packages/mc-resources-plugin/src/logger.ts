import chalk from 'chalk';
import manifest from '../package.json';

const PREFIX = chalk.cyan(`[mc-resources-plugin ${manifest.version}]`) + ' ';

const logger = {
  info: (message: string) => {
    console.log(PREFIX + message);
  },
  warn: (message: string) => {
    console.warn(PREFIX + chalk.bgRed("WARN") + " " + message);
  },
  debug: (message: string) => {
    console.log(PREFIX + chalk.bgBlue("DEBUG") + " " + message);
  },
};

export default logger;
