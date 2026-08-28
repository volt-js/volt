#!/usr/bin/env node
/**
 * The command, as a file that exists before anything is built.
 *
 * `bin` used to point straight at `dist/cli.js`, and a package manager links a
 * workspace bin when it installs — which in a fresh checkout is before any
 * package has been built, so there was nothing there to link and the command
 * did not exist afterwards either. CI installs, then builds, then runs it, and
 * that is the order this was failing in.
 *
 * A committed file is always there to be linked, and it defers everything to
 * the build output that will be.
 */
import './../dist/cli.js';
