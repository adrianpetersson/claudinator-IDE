/* eslint-disable @typescript-eslint/no-var-requires */
import { app } from 'electron';
import * as path from 'path';

// 1. Set app name BEFORE any app.getPath() calls
app.setName('Claudinator');

// 2. Install path aliases for main process
// @shared/* → dist/main/shared/*
// @/* → dist/main/main/*
const Module = require('module');
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (
  request: string,
  parent: unknown,
  isMain: boolean,
  options: unknown,
) {
  if (request.startsWith('@shared/')) {
    request = request.replace('@shared/', path.join(__dirname, '..', 'shared') + '/');
  } else if (request.startsWith('@/')) {
    request = request.replace('@/', __dirname + '/');
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

// 3. Load main process
require('./main');
