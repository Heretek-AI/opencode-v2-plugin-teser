// Tiny logger that respects --quiet/--verbose. info is suppressed when
// quiet; debug only shows when verbose (and not quiet); warn and error
// always show.
export interface LoggerOptions {
	quiet?: boolean;
	verbose?: boolean;
}

export interface Logger {
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
	debug(message: string): void;
}

export function createLogger(opts?: LoggerOptions): Logger {
	const quiet = opts?.quiet === true;
	const verbose = opts?.verbose === true && !quiet;
	return {
		info(message: string): void {
			if (!quiet) {
				console.log(message);
			}
		},
		warn(message: string): void {
			if (!quiet) {
				console.warn(message);
			}
		},
		error(message: string): void {
			console.error(message);
		},
		debug(message: string): void {
			if (verbose) {
				console.log(message);
			}
		},
	};
}
