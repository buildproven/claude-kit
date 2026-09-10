exports.id = 674;
exports.ids = [674];
exports.modules = {

/***/ 3116:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";

const path = __webpack_require__(6928)

let cmdExtension

if (process.env.PATHEXT) {
  cmdExtension = process.env.PATHEXT
    .split(path.delimiter)
    .find(ext => ext.toUpperCase() === '.CMD')
}

module.exports = cmdExtension || '.cmd'


/***/ }),

/***/ 3964:
/***/ ((module) => {

"use strict";


module.exports = clone

var getPrototypeOf = Object.getPrototypeOf || function (obj) {
  return obj.__proto__
}

function clone (obj) {
  if (obj === null || typeof obj !== 'object')
    return obj

  if (obj instanceof Object)
    var copy = { __proto__: getPrototypeOf(obj) }
  else
    var copy = Object.create(null)

  Object.getOwnPropertyNames(obj).forEach(function (key) {
    Object.defineProperty(copy, key, Object.getOwnPropertyDescriptor(obj, key))
  })

  return copy
}


/***/ }),

/***/ 3363:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

var fs = __webpack_require__(9896)
var polyfills = __webpack_require__(3501)
var legacy = __webpack_require__(2270)
var clone = __webpack_require__(3964)

var util = __webpack_require__(9023)

/* istanbul ignore next - node 0.x polyfill */
var gracefulQueue
var previousSymbol

/* istanbul ignore else - node 0.x polyfill */
if (typeof Symbol === 'function' && typeof Symbol.for === 'function') {
  gracefulQueue = Symbol.for('graceful-fs.queue')
  // This is used in testing by future versions
  previousSymbol = Symbol.for('graceful-fs.previous')
} else {
  gracefulQueue = '___graceful-fs.queue'
  previousSymbol = '___graceful-fs.previous'
}

function noop () {}

function publishQueue(context, queue) {
  Object.defineProperty(context, gracefulQueue, {
    get: function() {
      return queue
    }
  })
}

var debug = noop
if (util.debuglog)
  debug = util.debuglog('gfs4')
else if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || ''))
  debug = function() {
    var m = util.format.apply(util, arguments)
    m = 'GFS4: ' + m.split(/\n/).join('\nGFS4: ')
    console.error(m)
  }

// Once time initialization
if (!fs[gracefulQueue]) {
  // This queue can be shared by multiple loaded instances
  var queue = global[gracefulQueue] || []
  publishQueue(fs, queue)

  // Patch fs.close/closeSync to shared queue version, because we need
  // to retry() whenever a close happens *anywhere* in the program.
  // This is essential when multiple graceful-fs instances are
  // in play at the same time.
  fs.close = (function (fs$close) {
    function close (fd, cb) {
      return fs$close.call(fs, fd, function (err) {
        // This function uses the graceful-fs shared queue
        if (!err) {
          resetQueue()
        }

        if (typeof cb === 'function')
          cb.apply(this, arguments)
      })
    }

    Object.defineProperty(close, previousSymbol, {
      value: fs$close
    })
    return close
  })(fs.close)

  fs.closeSync = (function (fs$closeSync) {
    function closeSync (fd) {
      // This function uses the graceful-fs shared queue
      fs$closeSync.apply(fs, arguments)
      resetQueue()
    }

    Object.defineProperty(closeSync, previousSymbol, {
      value: fs$closeSync
    })
    return closeSync
  })(fs.closeSync)

  if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || '')) {
    process.on('exit', function() {
      debug(fs[gracefulQueue])
      __webpack_require__(2613).equal(fs[gracefulQueue].length, 0)
    })
  }
}

if (!global[gracefulQueue]) {
  publishQueue(global, fs[gracefulQueue]);
}

module.exports = patch(clone(fs))
if (process.env.TEST_GRACEFUL_FS_GLOBAL_PATCH && !fs.__patched) {
    module.exports = patch(fs)
    fs.__patched = true;
}

function patch (fs) {
  // Everything that references the open() function needs to be in here
  polyfills(fs)
  fs.gracefulify = patch

  fs.createReadStream = createReadStream
  fs.createWriteStream = createWriteStream
  var fs$readFile = fs.readFile
  fs.readFile = readFile
  function readFile (path, options, cb) {
    if (typeof options === 'function')
      cb = options, options = null

    return go$readFile(path, options, cb)

    function go$readFile (path, options, cb, startTime) {
      return fs$readFile(path, options, function (err) {
        if (err && (err.code === 'EMFILE' || err.code === 'ENFILE'))
          enqueue([go$readFile, [path, options, cb], err, startTime || Date.now(), Date.now()])
        else {
          if (typeof cb === 'function')
            cb.apply(this, arguments)
        }
      })
    }
  }

  var fs$writeFile = fs.writeFile
  fs.writeFile = writeFile
  function writeFile (path, data, options, cb) {
    if (typeof options === 'function')
      cb = options, options = null

    return go$writeFile(path, data, options, cb)

    function go$writeFile (path, data, options, cb, startTime) {
      return fs$writeFile(path, data, options, function (err) {
        if (err && (err.code === 'EMFILE' || err.code === 'ENFILE'))
          enqueue([go$writeFile, [path, data, options, cb], err, startTime || Date.now(), Date.now()])
        else {
          if (typeof cb === 'function')
            cb.apply(this, arguments)
        }
      })
    }
  }

  var fs$appendFile = fs.appendFile
  if (fs$appendFile)
    fs.appendFile = appendFile
  function appendFile (path, data, options, cb) {
    if (typeof options === 'function')
      cb = options, options = null

    return go$appendFile(path, data, options, cb)

    function go$appendFile (path, data, options, cb, startTime) {
      return fs$appendFile(path, data, options, function (err) {
        if (err && (err.code === 'EMFILE' || err.code === 'ENFILE'))
          enqueue([go$appendFile, [path, data, options, cb], err, startTime || Date.now(), Date.now()])
        else {
          if (typeof cb === 'function')
            cb.apply(this, arguments)
        }
      })
    }
  }

  var fs$copyFile = fs.copyFile
  if (fs$copyFile)
    fs.copyFile = copyFile
  function copyFile (src, dest, flags, cb) {
    if (typeof flags === 'function') {
      cb = flags
      flags = 0
    }
    return go$copyFile(src, dest, flags, cb)

    function go$copyFile (src, dest, flags, cb, startTime) {
      return fs$copyFile(src, dest, flags, function (err) {
        if (err && (err.code === 'EMFILE' || err.code === 'ENFILE'))
          enqueue([go$copyFile, [src, dest, flags, cb], err, startTime || Date.now(), Date.now()])
        else {
          if (typeof cb === 'function')
            cb.apply(this, arguments)
        }
      })
    }
  }

  var fs$readdir = fs.readdir
  fs.readdir = readdir
  var noReaddirOptionVersions = /^v[0-5]\./
  function readdir (path, options, cb) {
    if (typeof options === 'function')
      cb = options, options = null

    var go$readdir = noReaddirOptionVersions.test(process.version)
      ? function go$readdir (path, options, cb, startTime) {
        return fs$readdir(path, fs$readdirCallback(
          path, options, cb, startTime
        ))
      }
      : function go$readdir (path, options, cb, startTime) {
        return fs$readdir(path, options, fs$readdirCallback(
          path, options, cb, startTime
        ))
      }

    return go$readdir(path, options, cb)

    function fs$readdirCallback (path, options, cb, startTime) {
      return function (err, files) {
        if (err && (err.code === 'EMFILE' || err.code === 'ENFILE'))
          enqueue([
            go$readdir,
            [path, options, cb],
            err,
            startTime || Date.now(),
            Date.now()
          ])
        else {
          if (files && files.sort)
            files.sort()

          if (typeof cb === 'function')
            cb.call(this, err, files)
        }
      }
    }
  }

  if (process.version.substr(0, 4) === 'v0.8') {
    var legStreams = legacy(fs)
    ReadStream = legStreams.ReadStream
    WriteStream = legStreams.WriteStream
  }

  var fs$ReadStream = fs.ReadStream
  if (fs$ReadStream) {
    ReadStream.prototype = Object.create(fs$ReadStream.prototype)
    ReadStream.prototype.open = ReadStream$open
  }

  var fs$WriteStream = fs.WriteStream
  if (fs$WriteStream) {
    WriteStream.prototype = Object.create(fs$WriteStream.prototype)
    WriteStream.prototype.open = WriteStream$open
  }

  Object.defineProperty(fs, 'ReadStream', {
    get: function () {
      return ReadStream
    },
    set: function (val) {
      ReadStream = val
    },
    enumerable: true,
    configurable: true
  })
  Object.defineProperty(fs, 'WriteStream', {
    get: function () {
      return WriteStream
    },
    set: function (val) {
      WriteStream = val
    },
    enumerable: true,
    configurable: true
  })

  // legacy names
  var FileReadStream = ReadStream
  Object.defineProperty(fs, 'FileReadStream', {
    get: function () {
      return FileReadStream
    },
    set: function (val) {
      FileReadStream = val
    },
    enumerable: true,
    configurable: true
  })
  var FileWriteStream = WriteStream
  Object.defineProperty(fs, 'FileWriteStream', {
    get: function () {
      return FileWriteStream
    },
    set: function (val) {
      FileWriteStream = val
    },
    enumerable: true,
    configurable: true
  })

  function ReadStream (path, options) {
    if (this instanceof ReadStream)
      return fs$ReadStream.apply(this, arguments), this
    else
      return ReadStream.apply(Object.create(ReadStream.prototype), arguments)
  }

  function ReadStream$open () {
    var that = this
    open(that.path, that.flags, that.mode, function (err, fd) {
      if (err) {
        if (that.autoClose)
          that.destroy()

        that.emit('error', err)
      } else {
        that.fd = fd
        that.emit('open', fd)
        that.read()
      }
    })
  }

  function WriteStream (path, options) {
    if (this instanceof WriteStream)
      return fs$WriteStream.apply(this, arguments), this
    else
      return WriteStream.apply(Object.create(WriteStream.prototype), arguments)
  }

  function WriteStream$open () {
    var that = this
    open(that.path, that.flags, that.mode, function (err, fd) {
      if (err) {
        that.destroy()
        that.emit('error', err)
      } else {
        that.fd = fd
        that.emit('open', fd)
      }
    })
  }

  function createReadStream (path, options) {
    return new fs.ReadStream(path, options)
  }

  function createWriteStream (path, options) {
    return new fs.WriteStream(path, options)
  }

  var fs$open = fs.open
  fs.open = open
  function open (path, flags, mode, cb) {
    if (typeof mode === 'function')
      cb = mode, mode = null

    return go$open(path, flags, mode, cb)

    function go$open (path, flags, mode, cb, startTime) {
      return fs$open(path, flags, mode, function (err, fd) {
        if (err && (err.code === 'EMFILE' || err.code === 'ENFILE'))
          enqueue([go$open, [path, flags, mode, cb], err, startTime || Date.now(), Date.now()])
        else {
          if (typeof cb === 'function')
            cb.apply(this, arguments)
        }
      })
    }
  }

  return fs
}

function enqueue (elem) {
  debug('ENQUEUE', elem[0].name, elem[1])
  fs[gracefulQueue].push(elem)
  retry()
}

// keep track of the timeout between retry() calls
var retryTimer

// reset the startTime and lastTime to now
// this resets the start of the 60 second overall timeout as well as the
// delay between attempts so that we'll retry these jobs sooner
function resetQueue () {
  var now = Date.now()
  for (var i = 0; i < fs[gracefulQueue].length; ++i) {
    // entries that are only a length of 2 are from an older version, don't
    // bother modifying those since they'll be retried anyway.
    if (fs[gracefulQueue][i].length > 2) {
      fs[gracefulQueue][i][3] = now // startTime
      fs[gracefulQueue][i][4] = now // lastTime
    }
  }
  // call retry to make sure we're actively processing the queue
  retry()
}

function retry () {
  // clear the timer and remove it to help prevent unintended concurrency
  clearTimeout(retryTimer)
  retryTimer = undefined

  if (fs[gracefulQueue].length === 0)
    return

  var elem = fs[gracefulQueue].shift()
  var fn = elem[0]
  var args = elem[1]
  // these items may be unset if they were added by an older graceful-fs
  var err = elem[2]
  var startTime = elem[3]
  var lastTime = elem[4]

  // if we don't have a startTime we have no way of knowing if we've waited
  // long enough, so go ahead and retry this item now
  if (startTime === undefined) {
    debug('RETRY', fn.name, args)
    fn.apply(null, args)
  } else if (Date.now() - startTime >= 60000) {
    // it's been more than 60 seconds total, bail now
    debug('TIMEOUT', fn.name, args)
    var cb = args.pop()
    if (typeof cb === 'function')
      cb.call(null, err)
  } else {
    // the amount of time between the last attempt and right now
    var sinceAttempt = Date.now() - lastTime
    // the amount of time between when we first tried, and when we last tried
    // rounded up to at least 1
    var sinceStart = Math.max(lastTime - startTime, 1)
    // backoff. wait longer than the total time we've been retrying, but only
    // up to a maximum of 100ms
    var desiredDelay = Math.min(sinceStart * 1.2, 100)
    // it's been long enough since the last retry, do it again
    if (sinceAttempt >= desiredDelay) {
      debug('RETRY', fn.name, args)
      fn.apply(null, args.concat([startTime]))
    } else {
      // if we can't do this job yet, push it to the end of the queue
      // and let the next iteration check again
      fs[gracefulQueue].push(elem)
    }
  }

  // schedule our next run if one isn't already scheduled
  if (retryTimer === undefined) {
    retryTimer = setTimeout(retry, 0)
  }
}


/***/ }),

/***/ 2270:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

var Stream = (__webpack_require__(2203).Stream)

module.exports = legacy

function legacy (fs) {
  return {
    ReadStream: ReadStream,
    WriteStream: WriteStream
  }

  function ReadStream (path, options) {
    if (!(this instanceof ReadStream)) return new ReadStream(path, options);

    Stream.call(this);

    var self = this;

    this.path = path;
    this.fd = null;
    this.readable = true;
    this.paused = false;

    this.flags = 'r';
    this.mode = 438; /*=0666*/
    this.bufferSize = 64 * 1024;

    options = options || {};

    // Mixin options into this
    var keys = Object.keys(options);
    for (var index = 0, length = keys.length; index < length; index++) {
      var key = keys[index];
      this[key] = options[key];
    }

    if (this.encoding) this.setEncoding(this.encoding);

    if (this.start !== undefined) {
      if ('number' !== typeof this.start) {
        throw TypeError('start must be a Number');
      }
      if (this.end === undefined) {
        this.end = Infinity;
      } else if ('number' !== typeof this.end) {
        throw TypeError('end must be a Number');
      }

      if (this.start > this.end) {
        throw new Error('start must be <= end');
      }

      this.pos = this.start;
    }

    if (this.fd !== null) {
      process.nextTick(function() {
        self._read();
      });
      return;
    }

    fs.open(this.path, this.flags, this.mode, function (err, fd) {
      if (err) {
        self.emit('error', err);
        self.readable = false;
        return;
      }

      self.fd = fd;
      self.emit('open', fd);
      self._read();
    })
  }

  function WriteStream (path, options) {
    if (!(this instanceof WriteStream)) return new WriteStream(path, options);

    Stream.call(this);

    this.path = path;
    this.fd = null;
    this.writable = true;

    this.flags = 'w';
    this.encoding = 'binary';
    this.mode = 438; /*=0666*/
    this.bytesWritten = 0;

    options = options || {};

    // Mixin options into this
    var keys = Object.keys(options);
    for (var index = 0, length = keys.length; index < length; index++) {
      var key = keys[index];
      this[key] = options[key];
    }

    if (this.start !== undefined) {
      if ('number' !== typeof this.start) {
        throw TypeError('start must be a Number');
      }
      if (this.start < 0) {
        throw new Error('start must be >= zero');
      }

      this.pos = this.start;
    }

    this.busy = false;
    this._queue = [];

    if (this.fd === null) {
      this._open = fs.open;
      this._queue.push([this._open, this.path, this.flags, this.mode, undefined]);
      this.flush();
    }
  }
}


/***/ }),

/***/ 3501:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

var constants = __webpack_require__(9140)

var origCwd = process.cwd
var cwd = null

var platform = process.env.GRACEFUL_FS_PLATFORM || process.platform

process.cwd = function() {
  if (!cwd)
    cwd = origCwd.call(process)
  return cwd
}
try {
  process.cwd()
} catch (er) {}

// This check is needed until node.js 12 is required
if (typeof process.chdir === 'function') {
  var chdir = process.chdir
  process.chdir = function (d) {
    cwd = null
    chdir.call(process, d)
  }
  if (Object.setPrototypeOf) Object.setPrototypeOf(process.chdir, chdir)
}

module.exports = patch

function patch (fs) {
  // (re-)implement some things that are known busted or missing.

  // lchmod, broken prior to 0.6.2
  // back-port the fix here.
  if (constants.hasOwnProperty('O_SYMLINK') &&
      process.version.match(/^v0\.6\.[0-2]|^v0\.5\./)) {
    patchLchmod(fs)
  }

  // lutimes implementation, or no-op
  if (!fs.lutimes) {
    patchLutimes(fs)
  }

  // https://github.com/isaacs/node-graceful-fs/issues/4
  // Chown should not fail on einval or eperm if non-root.
  // It should not fail on enosys ever, as this just indicates
  // that a fs doesn't support the intended operation.

  fs.chown = chownFix(fs.chown)
  fs.fchown = chownFix(fs.fchown)
  fs.lchown = chownFix(fs.lchown)

  fs.chmod = chmodFix(fs.chmod)
  fs.fchmod = chmodFix(fs.fchmod)
  fs.lchmod = chmodFix(fs.lchmod)

  fs.chownSync = chownFixSync(fs.chownSync)
  fs.fchownSync = chownFixSync(fs.fchownSync)
  fs.lchownSync = chownFixSync(fs.lchownSync)

  fs.chmodSync = chmodFixSync(fs.chmodSync)
  fs.fchmodSync = chmodFixSync(fs.fchmodSync)
  fs.lchmodSync = chmodFixSync(fs.lchmodSync)

  fs.stat = statFix(fs.stat)
  fs.fstat = statFix(fs.fstat)
  fs.lstat = statFix(fs.lstat)

  fs.statSync = statFixSync(fs.statSync)
  fs.fstatSync = statFixSync(fs.fstatSync)
  fs.lstatSync = statFixSync(fs.lstatSync)

  // if lchmod/lchown do not exist, then make them no-ops
  if (fs.chmod && !fs.lchmod) {
    fs.lchmod = function (path, mode, cb) {
      if (cb) process.nextTick(cb)
    }
    fs.lchmodSync = function () {}
  }
  if (fs.chown && !fs.lchown) {
    fs.lchown = function (path, uid, gid, cb) {
      if (cb) process.nextTick(cb)
    }
    fs.lchownSync = function () {}
  }

  // on Windows, A/V software can lock the directory, causing this
  // to fail with an EACCES or EPERM if the directory contains newly
  // created files.  Try again on failure, for up to 60 seconds.

  // Set the timeout this long because some Windows Anti-Virus, such as Parity
  // bit9, may lock files for up to a minute, causing npm package install
  // failures. Also, take care to yield the scheduler. Windows scheduling gives
  // CPU to a busy looping process, which can cause the program causing the lock
  // contention to be starved of CPU by node, so the contention doesn't resolve.
  if (platform === "win32") {
    fs.rename = typeof fs.rename !== 'function' ? fs.rename
    : (function (fs$rename) {
      function rename (from, to, cb) {
        var start = Date.now()
        var backoff = 0;
        fs$rename(from, to, function CB (er) {
          if (er
              && (er.code === "EACCES" || er.code === "EPERM" || er.code === "EBUSY")
              && Date.now() - start < 60000) {
            setTimeout(function() {
              fs.stat(to, function (stater, st) {
                if (stater && stater.code === "ENOENT")
                  fs$rename(from, to, CB);
                else
                  cb(er)
              })
            }, backoff)
            if (backoff < 100)
              backoff += 10;
            return;
          }
          if (cb) cb(er)
        })
      }
      if (Object.setPrototypeOf) Object.setPrototypeOf(rename, fs$rename)
      return rename
    })(fs.rename)
  }

  // if read() returns EAGAIN, then just try it again.
  fs.read = typeof fs.read !== 'function' ? fs.read
  : (function (fs$read) {
    function read (fd, buffer, offset, length, position, callback_) {
      var callback
      if (callback_ && typeof callback_ === 'function') {
        var eagCounter = 0
        callback = function (er, _, __) {
          if (er && er.code === 'EAGAIN' && eagCounter < 10) {
            eagCounter ++
            return fs$read.call(fs, fd, buffer, offset, length, position, callback)
          }
          callback_.apply(this, arguments)
        }
      }
      return fs$read.call(fs, fd, buffer, offset, length, position, callback)
    }

    // This ensures `util.promisify` works as it does for native `fs.read`.
    if (Object.setPrototypeOf) Object.setPrototypeOf(read, fs$read)
    return read
  })(fs.read)

  fs.readSync = typeof fs.readSync !== 'function' ? fs.readSync
  : (function (fs$readSync) { return function (fd, buffer, offset, length, position) {
    var eagCounter = 0
    while (true) {
      try {
        return fs$readSync.call(fs, fd, buffer, offset, length, position)
      } catch (er) {
        if (er.code === 'EAGAIN' && eagCounter < 10) {
          eagCounter ++
          continue
        }
        throw er
      }
    }
  }})(fs.readSync)

  function patchLchmod (fs) {
    fs.lchmod = function (path, mode, callback) {
      fs.open( path
             , constants.O_WRONLY | constants.O_SYMLINK
             , mode
             , function (err, fd) {
        if (err) {
          if (callback) callback(err)
          return
        }
        // prefer to return the chmod error, if one occurs,
        // but still try to close, and report closing errors if they occur.
        fs.fchmod(fd, mode, function (err) {
          fs.close(fd, function(err2) {
            if (callback) callback(err || err2)
          })
        })
      })
    }

    fs.lchmodSync = function (path, mode) {
      var fd = fs.openSync(path, constants.O_WRONLY | constants.O_SYMLINK, mode)

      // prefer to return the chmod error, if one occurs,
      // but still try to close, and report closing errors if they occur.
      var threw = true
      var ret
      try {
        ret = fs.fchmodSync(fd, mode)
        threw = false
      } finally {
        if (threw) {
          try {
            fs.closeSync(fd)
          } catch (er) {}
        } else {
          fs.closeSync(fd)
        }
      }
      return ret
    }
  }

  function patchLutimes (fs) {
    if (constants.hasOwnProperty("O_SYMLINK") && fs.futimes) {
      fs.lutimes = function (path, at, mt, cb) {
        fs.open(path, constants.O_SYMLINK, function (er, fd) {
          if (er) {
            if (cb) cb(er)
            return
          }
          fs.futimes(fd, at, mt, function (er) {
            fs.close(fd, function (er2) {
              if (cb) cb(er || er2)
            })
          })
        })
      }

      fs.lutimesSync = function (path, at, mt) {
        var fd = fs.openSync(path, constants.O_SYMLINK)
        var ret
        var threw = true
        try {
          ret = fs.futimesSync(fd, at, mt)
          threw = false
        } finally {
          if (threw) {
            try {
              fs.closeSync(fd)
            } catch (er) {}
          } else {
            fs.closeSync(fd)
          }
        }
        return ret
      }

    } else if (fs.futimes) {
      fs.lutimes = function (_a, _b, _c, cb) { if (cb) process.nextTick(cb) }
      fs.lutimesSync = function () {}
    }
  }

  function chmodFix (orig) {
    if (!orig) return orig
    return function (target, mode, cb) {
      return orig.call(fs, target, mode, function (er) {
        if (chownErOk(er)) er = null
        if (cb) cb.apply(this, arguments)
      })
    }
  }

  function chmodFixSync (orig) {
    if (!orig) return orig
    return function (target, mode) {
      try {
        return orig.call(fs, target, mode)
      } catch (er) {
        if (!chownErOk(er)) throw er
      }
    }
  }


  function chownFix (orig) {
    if (!orig) return orig
    return function (target, uid, gid, cb) {
      return orig.call(fs, target, uid, gid, function (er) {
        if (chownErOk(er)) er = null
        if (cb) cb.apply(this, arguments)
      })
    }
  }

  function chownFixSync (orig) {
    if (!orig) return orig
    return function (target, uid, gid) {
      try {
        return orig.call(fs, target, uid, gid)
      } catch (er) {
        if (!chownErOk(er)) throw er
      }
    }
  }

  function statFix (orig) {
    if (!orig) return orig
    // Older versions of Node erroneously returned signed integers for
    // uid + gid.
    return function (target, options, cb) {
      if (typeof options === 'function') {
        cb = options
        options = null
      }
      function callback (er, stats) {
        if (stats) {
          if (stats.uid < 0) stats.uid += 0x100000000
          if (stats.gid < 0) stats.gid += 0x100000000
        }
        if (cb) cb.apply(this, arguments)
      }
      return options ? orig.call(fs, target, options, callback)
        : orig.call(fs, target, callback)
    }
  }

  function statFixSync (orig) {
    if (!orig) return orig
    // Older versions of Node erroneously returned signed integers for
    // uid + gid.
    return function (target, options) {
      var stats = options ? orig.call(fs, target, options)
        : orig.call(fs, target)
      if (stats) {
        if (stats.uid < 0) stats.uid += 0x100000000
        if (stats.gid < 0) stats.gid += 0x100000000
      }
      return stats;
    }
  }

  // ENOSYS means that the fs doesn't support the op. Just ignore
  // that, because it doesn't matter.
  //
  // if there's no getuid, or if getuid() is something other
  // than 0, and the error is EINVAL or EPERM, then just ignore
  // it.
  //
  // This specific case is a silent failure in cp, install, tar,
  // and most other unix tools that manage permissions.
  //
  // When running as root, or if other types of errors are
  // encountered, then it's strict.
  function chownErOk (er) {
    if (!er)
      return true

    if (er.code === "ENOSYS")
      return true

    var nonroot = !process.getuid || process.getuid() !== 0
    if (nonroot) {
      if (er.code === "EINVAL" || er.code === "EPERM")
        return true
    }

    return false
  }
}


/***/ }),

/***/ 674:
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {

"use strict";
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   cmdShim: () => (/* binding */ cmdShim)
/* harmony export */ });
/* unused harmony exports cmdShimIfExists, isShimPointingAt */
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(6760);
/* harmony import */ var node_util__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(7975);
/* harmony import */ var graceful_fs__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(3363);
/* harmony import */ var cmd_extension__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(3116);
// On windows, create a .cmd file.
// Read the #! in the file to see what it uses.  The vast majority
// of the time, this will be either:
// "#!/usr/bin/env <prog> <args...>"
// or:
// "#!<prog> <args...>"
//
// Write a binroot/pkg.bin + ".cmd" file that has this line in it:
// @<prog> <args...> %~dp0<target> %*




// graceful-fs patches the callback API with EMFILE retry/queueing.
// fs.promises bypasses those patches, so we promisify the patched
// callback functions instead. This is the same pattern @pnpm/fs.graceful-fs
// uses, inlined here to avoid a workspace dependency.
const gfsPromises = {
    chmod: (0,node_util__WEBPACK_IMPORTED_MODULE_1__.promisify)(graceful_fs__WEBPACK_IMPORTED_MODULE_2__.chmod),
    mkdir: (0,node_util__WEBPACK_IMPORTED_MODULE_1__.promisify)(graceful_fs__WEBPACK_IMPORTED_MODULE_2__.mkdir),
    readFile: (0,node_util__WEBPACK_IMPORTED_MODULE_1__.promisify)(graceful_fs__WEBPACK_IMPORTED_MODULE_2__.readFile),
    stat: (0,node_util__WEBPACK_IMPORTED_MODULE_1__.promisify)(graceful_fs__WEBPACK_IMPORTED_MODULE_2__.stat),
    unlink: (0,node_util__WEBPACK_IMPORTED_MODULE_1__.promisify)(graceful_fs__WEBPACK_IMPORTED_MODULE_2__.unlink),
    writeFile: (0,node_util__WEBPACK_IMPORTED_MODULE_1__.promisify)(graceful_fs__WEBPACK_IMPORTED_MODULE_2__.writeFile),
};
const isWindows = process.platform === 'win32';
const isCygwin = () => isWindows && (process.env.TERM === 'CYGWIN' || process.env.MSYSTEM !== undefined);
const shebangExpr = /^#!\s*(?:\/usr\/bin\/env(?:\s+-S\s*)?)?\s*([^ \t]+)(.*)$/;
const DEFAULT_OPTIONS = {
    // Create PowerShell file by default if the option hasn't been specified
    createPwshFile: true,
    createCmdFile: isWindows,
};
/**
 * Map from extensions of files that this module is frequently used for to their runtime.
 * @type {Map<string, string>}
 */
const extensionToProgramMap = new Map([
    ['.js', 'node'],
    ['.cjs', 'node'],
    ['.mjs', 'node'],
    ['.cmd', 'cmd'],
    ['.bat', 'cmd'],
    ['.ps1', 'pwsh'],
    ['.sh', 'sh']
]);
function ingestOptions(opts) {
    const opts_ = { ...DEFAULT_OPTIONS, ...opts };
    // Tests and other callers may still inject a custom fs (e.g. memfs).
    opts_.fs_ = opts_.fs ? opts_.fs.promises : gfsPromises;
    return opts_;
}
/**
 * Try to create shims.
 *
 * @param src Path to program (executable or script).
 * @param to Path to shims.
 * Don't add an extension if you will create multiple types of shims.
 * @param opts Options.
 * @throws If `src` is missing.
 */
async function cmdShim(src, to, opts) {
    const opts_ = ingestOptions(opts);
    await cmdShim_(src, to, opts_);
}
/**
 * Try to create shims.
 *
 * Does nothing if `src` doesn't exist.
 *
 * @param src Path to program (executable or script).
 * @param to Path to shims.
 * Don't add an extension if you will create multiple types of shims.
 * @param opts Options.
 */
function cmdShimIfExists(src, to, opts) {
    return cmdShim(src, to, opts).catch(() => { });
}
/**
 * Check whether a shim's content points at the given source path.
 *
 * @param shimContent The text content of the shim file.
 * @param src The expected source path (the executable the shim should point to).
 * @return `true` if the shim contains a matching target marker.
 */
function isShimPointingAt(shimContent, src) {
    return shimContent.includes(`# ${shimTarget(src)}\n`);
}
/**
 * Try to unlink, but ignore errors.
 * Any problems will surface later.
 *
 * @param path File to be removed.
 */
function rm(path, opts) {
    return opts.fs_.unlink(path).catch(() => { });
}
/**
 * Try to create shims **even if `src` is missing**.
 *
 * @param src Path to program (executable or script).
 * @param to Path to shims.
 * Don't add an extension if you will create multiple types of shims.
 * @param opts Options.
 */
async function cmdShim_(src, to, opts) {
    const srcRuntimeInfo = await searchScriptRuntime(src, opts);
    // Always tries to create all types of shims by calling `writeAllShims` as of now.
    // Append your code here to change the behavior in response to `srcRuntimeInfo`.
    // Create 3 shims for (Ba)sh in Cygwin / MSYS, no extension) & CMD (.cmd) & PowerShell (.ps1)
    await writeShimsPreCommon(to, opts);
    return writeAllShims(src, to, srcRuntimeInfo, opts);
}
/**
 * Do processes before **all** shims are created.
 * This must be called **only once** for one call of `cmdShim(IfExists)`.
 *
 * @param target Path of shims that are going to be created.
 */
function writeShimsPreCommon(target, opts) {
    return opts.fs_.mkdir(node_path__WEBPACK_IMPORTED_MODULE_0__.dirname(target), { recursive: true });
}
/**
 * Write all types (sh & cmd & pwsh) of shims to files.
 * Extensions (`.cmd` and `.ps1`) are appended to cmd and pwsh shims.
 *
 *
 * @param src Path to program (executable or script).
 * @param to Path to shims **without extensions**.
 * Extensions are added for CMD and PowerShell shims.
 * @param srcRuntimeInfo Return value of `await searchScriptRuntime(src)`.
 * @param opts Options.
 */
function writeAllShims(src, to, srcRuntimeInfo, opts) {
    const opts_ = ingestOptions(opts);
    const generatorAndExts = [{ generator: generateShShim, extension: '' }];
    if (opts_.createCmdFile) {
        generatorAndExts.push({ generator: generateCmdShim, extension: cmd_extension__WEBPACK_IMPORTED_MODULE_3__ });
    }
    if (opts_.createPwshFile) {
        generatorAndExts.push({ generator: generatePwshShim, extension: '.ps1' });
    }
    return Promise.all(generatorAndExts.map((generatorAndExt) => writeShim(src, to + generatorAndExt.extension, srcRuntimeInfo, generatorAndExt.generator, opts_)));
}
/**
 * Do processes before writing shim.
 *
 * @param target Path to shim that is going to be created.
 */
function writeShimPre(target, opts) {
    return rm(target, opts);
}
/**
 * Do processes after writing the shim.
 *
 * @param target Path to just created shim.
 */
function writeShimPost(target, opts) {
    // Only chmoding shims as of now.
    // Some other processes may be appended.
    return chmodShim(target, opts);
}
/**
 * Look into runtime (e.g. `node` & `sh` & `pwsh`) and its arguments
 * of the target program (script or executable).
 *
 * @param target Path to the executable or script.
 * @return Promise of infomation of runtime of `target`.
 */
async function searchScriptRuntime(target, opts) {
    try {
        const data = await opts.fs_.readFile(target, 'utf8');
        // First, check if the bin is a #! of some sort.
        const firstLine = data.trim().split(/\r*\n/)[0];
        const shebang = firstLine.match(shebangExpr);
        if (!shebang) {
            // If not, infer script type from its extension.
            // If the inference fails, it's something that'll be compiled, or some other
            // sort of script, and just call it directly.
            const targetExtension = node_path__WEBPACK_IMPORTED_MODULE_0__.extname(target).toLowerCase();
            // undefined if extension is unknown but it's converted to null.
            const program = extensionToProgramMap.get(targetExtension) || null;
            // CMD requires executing batch files with the `/C` flag
            const additionalArgs = program === 'cmd' ? '/C' : '';
            return {
                program,
                additionalArgs
            };
        }
        return {
            program: shebang[1],
            additionalArgs: shebang[2]
        };
    }
    catch (err) {
        if (!isWindows || err.code !== 'ENOENT')
            throw err;
        if (await opts.fs_.stat(`${target}${getExeExtension()}`)) {
            return {
                program: null,
                additionalArgs: '',
            };
        }
        throw err;
    }
}
function getExeExtension() {
    let cmdExtension;
    if (process.env.PATHEXT) {
        cmdExtension = process.env.PATHEXT
            .split(node_path__WEBPACK_IMPORTED_MODULE_0__.delimiter)
            .find(ext => ext.toLowerCase() === '.exe');
    }
    return cmdExtension || '.exe';
}
/**
 * Prefix bare `/C` / `/K` switches with an extra `/` so MSYS / Git Bash
 * passes them through to cmd.exe unchanged instead of converting them to
 * `C:\` / `K:\` paths. See {@link generateShShim} for context.
 */
function escapeMsysCmdSwitches(args) {
    return args.replace(/(^|\s)\/([CcKk])(\s|$)/g, '$1//$2$3');
}
/**
 * Write shim to the file system while executing the pre- and post-processes
 * defined in `WriteShimPre` and `WriteShimPost`.
 *
 * @param src Path to the executable or script.
 * @param to Path to the (sh) shim(s) that is going to be created.
 * @param srcRuntimeInfo Result of `await searchScriptRuntime(src)`.
 * @param generateShimScript Generator of shim script.
 * @param opts Other options.
 */
async function writeShim(src, to, srcRuntimeInfo, generateShimScript, opts) {
    const defaultArgs = opts.preserveSymlinks ? '--preserve-symlinks' : '';
    // `Array.prototype.filter` removes ''.
    // ['--foo', '--bar'].join(' ') and [].join(' ') returns '--foo --bar' and '' respectively.
    const args = [srcRuntimeInfo.additionalArgs, defaultArgs].filter(arg => arg).join(' ');
    opts = Object.assign({}, opts, {
        prog: srcRuntimeInfo.program,
        args: args
    });
    await writeShimPre(to, opts);
    await opts.fs_.writeFile(to, generateShimScript(src, to, opts), 'utf8');
    return writeShimPost(to, opts);
}
/**
 * Generate the content of a shim for CMD.
 *
 * @param src Path to the executable or script.
 * @param to Path to the shim to be created.
 * It is highly recommended to end with `.cmd` (or `.bat`).
 * @param opts Options.
 * @return The content of shim.
 */
function generateCmdShim(src, to, opts) {
    // `shTarget` is not used to generate the content.
    const shTarget = node_path__WEBPACK_IMPORTED_MODULE_0__.relative(node_path__WEBPACK_IMPORTED_MODULE_0__.dirname(to), src);
    let target = shTarget.split('/').join('\\');
    const quotedPathToTarget = node_path__WEBPACK_IMPORTED_MODULE_0__.isAbsolute(target) ? `"${target}"` : `"%~dp0\\${target}"`;
    let longProg;
    let prog = opts.prog;
    let args = opts.args || '';
    const nodePath = normalizePathEnvVar(opts.nodePath).win32;
    const prependToPath = normalizePathEnvVar(opts.prependToPath).win32;
    if (!prog) {
        prog = quotedPathToTarget;
        args = '';
        target = '';
    }
    else if (prog === 'node' && opts.nodeExecPath) {
        prog = `"${opts.nodeExecPath}"`;
        target = quotedPathToTarget;
    }
    else {
        longProg = `"%~dp0\\${prog}.exe"`;
        target = quotedPathToTarget;
    }
    let progArgs = opts.progArgs ? `${opts.progArgs.join(` `)} ` : '';
    // @IF EXIST "%~dp0\node.exe" (
    //   "%~dp0\node.exe" "%~dp0\.\node_modules\npm\bin\npm-cli.js" %*
    // ) ELSE (
    //   SETLOCAL
    //   SET PATHEXT=%PATHEXT:;.JS;=;%
    //   node "%~dp0\.\node_modules\npm\bin\npm-cli.js" %*
    // )
    let cmd = '@SETLOCAL\r\n';
    if (prependToPath) {
        cmd += `@SET "PATH=${prependToPath}:%PATH%"\r\n`;
    }
    if (nodePath) {
        cmd += `\
@IF NOT DEFINED NODE_PATH (\r
  @SET "NODE_PATH=${nodePath}"\r
) ELSE (\r
  @SET "NODE_PATH=${nodePath};%NODE_PATH%"\r
)\r
`;
    }
    if (longProg) {
        cmd += `\
@IF EXIST ${longProg} (\r
  ${longProg} ${args} ${target} ${progArgs}%*\r
) ELSE (\r
  @SET PATHEXT=%PATHEXT:;.JS;=;%\r
  ${prog} ${args} ${target} ${progArgs}%*\r
)\r
`;
    }
    else {
        cmd += `@${prog} ${args} ${target} ${progArgs}%*\r\n`;
    }
    return cmd;
}
/**
 * Generate the content of a shim for (Ba)sh in, for example, Cygwin and MSYS(2).
 *
 * @param src Path to the executable or script.
 * @param to Path to the shim to be created.
 * It is highly recommended to end with `.sh` or to contain no extension.
 * @param opts Options.
 * @return The content of shim.
 */
function generateShShim(src, to, opts) {
    let shTarget = node_path__WEBPACK_IMPORTED_MODULE_0__.relative(node_path__WEBPACK_IMPORTED_MODULE_0__.dirname(to), src);
    let shProg = opts.prog && opts.prog.split('\\').join('/');
    let shLongProg;
    let shLongProgExe = '';
    let shProgExe = '';
    let shProgHasExe = false;
    shTarget = shTarget.split('\\').join('/');
    const quotedPathToTarget = node_path__WEBPACK_IMPORTED_MODULE_0__.isAbsolute(shTarget) ? `"${shTarget}"` : `"$basedir/${shTarget}"`;
    const quotedPathToTarget_win = node_path__WEBPACK_IMPORTED_MODULE_0__.isAbsolute(shTarget) ? `"${shTarget}"` : `"$basedir_win/${shTarget}"`;
    let shTarget_win = '';
    let args = opts.args || '';
    const isCmdRuntime = opts.prog === 'cmd' || opts.prog === 'cmd.exe';
    const shNodePath = normalizePathEnvVar(opts.nodePath).posix;
    if (!shProg) {
        shProg = quotedPathToTarget;
        args = '';
        shTarget = '';
    }
    else if (opts.prog === 'node' && opts.nodeExecPath) {
        shProg = `"${opts.nodeExecPath}"`;
        shTarget = /\.exe$/.test(opts.nodeExecPath) ? quotedPathToTarget_win : quotedPathToTarget;
    }
    else {
        shProgHasExe = /\.exe$/i.test(shProg);
        shProgExe = shProgHasExe ? shProg : `${shProg}.exe`;
        shLongProg = `"$basedir/${shProg}"`;
        shLongProgExe = `"$basedir/${shProgExe}"`;
        shTarget = quotedPathToTarget;
        shTarget_win = quotedPathToTarget_win;
    }
    let progArgs = opts.progArgs ? `${opts.progArgs.join(` `)} ` : '';
    // #!/bin/sh
    // # Resolve $0 through symlinks so basedir is the shim's real directory.
    // # Cap hops at the kernel's ELOOP limit so a cycle cannot hang the shim.
    // link="$0"
    // hops=0
    // while [ -L "$link" ] && [ "$hops" -lt 40 ]; do
    //   hops=$((hops+1))
    //   target=$(readlink "$link")
    //   case "$target" in
    //     /*) link="$target" ;;
    //     *)  link="$(dirname "$link")/$target" ;;
    //   esac
    // done
    // basedir=$(dirname "$(echo "$link" | sed -e 's,\\,/,g')")
    // basedir_win="$basedir"
    // exe=""
    // msys=""
    //
    // case `uname -a` in
    //   *CYGWIN*|*MINGW*|*MSYS*)
    //     if command -v cygpath > /dev/null 2>&1; then
    //       basedir_win=`cygpath -w "$basedir"`
    //     fi
    //     exe=".exe"
    //     msys="true"
    //   ;;
    //   *WSL2*)
    //     if command -v wslpath > /dev/null 2>&1; then
    //       basedir_win="$(wslpath -w "$basedir" 2> /dev/null)"
    //       if [ $? -ne 0 ] || [ -z "$basedir_win" ]; then
    //         basedir_win="$basedir"
    //       else
    //         exe=".exe"
    //       fi
    //     fi
    //   ;;
    // esac
    //
    // export NODE_PATH="<nodepath>"
    //
    // if [ -x "$basedir/node.exe" ]; then
    //   exec "$basedir/node.exe"  "$basedir_win/node_modules/npm/bin/npm-cli.js" "$@"
    // elif [ -x "$basedir/node" ]; then
    //   exec "$basedir/node"  "$basedir/node_modules/npm/bin/npm-cli.js" "$@"
    // elif command -v node >/dev/null 2>&1; then
    //   exec node  "$basedir/node_modules/npm/bin/npm-cli.js" "$@"
    // elif [ -n "$exe" ] && command -v node.exe >/dev/null 2>&1; then
    //   exec node.exe  "$basedir_win/node_modules/npm/bin/npm-cli.js" "$@"
    // else
    //   exec node  "$basedir/node_modules/npm/bin/npm-cli.js" "$@"
    // fi
    let sh = `\
#!/bin/sh
# Resolve $0 through symlinks so basedir is the shim's real directory.
# Cap hops at the kernel's ELOOP limit so a cycle cannot hang the shim.
link="$0"
hops=0
while [ -L "$link" ] && [ "$hops" -lt 40 ]; do
  hops=$((hops+1))
  target=$(readlink "$link")
  case "$target" in
    /*) link="$target" ;;
    *)  link="$(dirname "$link")/$target" ;;
  esac
done
basedir=$(dirname "$(echo "$link" | sed -e 's,\\\\,/,g')")
basedir_win="$basedir"
exe=""
msys=""

case \`uname -a\` in
  *CYGWIN*|*MINGW*|*MSYS*)
    if command -v cygpath > /dev/null 2>&1; then
      basedir_win=\`cygpath -w "$basedir"\`
    fi
    exe=".exe"
    msys="true"
  ;;
  *WSL2*)
    if command -v wslpath > /dev/null 2>&1; then
      basedir_win="$(wslpath -w "$basedir" 2> /dev/null)"
      if [ $? -ne 0 ] || [ -z "$basedir_win" ]; then
        basedir_win="$basedir"
      else
        exe=".exe"
      fi
    fi
  ;;
esac

`;
    if (opts.prependToPath) {
        sh += `\
export PATH="${opts.prependToPath}:$PATH"
`;
    }
    if (shNodePath) {
        sh += `\
if [ -z "$NODE_PATH" ]; then
  export NODE_PATH="${shNodePath}"
else
  export NODE_PATH="${shNodePath}:$NODE_PATH"
fi
`;
    }
    const generateExecBlock = (execArgs) => {
        if (shLongProg) {
            if (shProgHasExe) {
                return `\
if [ -x ${shLongProgExe} ]; then
  exec ${shLongProgExe} ${execArgs} ${shTarget_win} ${progArgs}"$@"
else
  exec ${shProgExe} ${execArgs} ${shTarget_win} ${progArgs}"$@"
fi
`;
            }
            else {
                return `\
if [ -n "$exe" ] && [ -x ${shLongProgExe} ]; then
  exec ${shLongProgExe} ${execArgs} ${shTarget_win} ${progArgs}"$@"
elif [ -x ${shLongProg} ]; then
  exec ${shLongProg} ${execArgs} ${shTarget} ${progArgs}"$@"
elif command -v ${shProg} >/dev/null 2>&1; then
  exec ${shProg} ${execArgs} ${shTarget} ${progArgs}"$@"
elif [ -n "$exe" ] && command -v ${shProgExe} >/dev/null 2>&1; then
  exec ${shProgExe} ${execArgs} ${shTarget_win} ${progArgs}"$@"
else
  exec ${shProg} ${execArgs} ${shTarget} ${progArgs}"$@"
fi
`;
            }
        }
        else {
            return `\
exec ${shProg} ${execArgs} ${shTarget} ${progArgs}"$@"
exit $?
`;
        }
    };
    const msysArgs = isCmdRuntime ? escapeMsysCmdSwitches(args) : args;
    if (msysArgs !== args) {
        sh += `\
if [ -n "$msys" ]; then
${indentShellBlock(generateExecBlock(msysArgs))}
else
${indentShellBlock(generateExecBlock(args))}
fi
`;
    }
    else {
        sh += generateExecBlock(args);
    }
    // Marker used by consumers to detect whether the shim is up-to-date
    // without parsing the script content.
    sh += `# ${shimTarget(src)}\n`;
    return sh;
}
function indentShellBlock(script) {
    return script.split('\n').map(line => line ? `  ${line}` : line).join('\n');
}
/**
 * Generate the content of a shim for PowerShell.
 *
 * @param src Path to the executable or script.
 * @param to Path to the shim to be created.
 * It is highly recommended to end with `.ps1`.
 * @param opts Options.
 * @return The content of shim.
 */
function generatePwshShim(src, to, opts) {
    let shTarget = node_path__WEBPACK_IMPORTED_MODULE_0__.relative(node_path__WEBPACK_IMPORTED_MODULE_0__.dirname(to), src);
    const shProg = opts.prog && opts.prog.split('\\').join('/');
    let pwshProg = shProg && `"${shProg}$exe"`;
    let pwshLongProg;
    shTarget = shTarget.split('\\').join('/');
    const quotedPathToTarget = node_path__WEBPACK_IMPORTED_MODULE_0__.isAbsolute(shTarget) ? `"${shTarget}"` : `"$basedir/${shTarget}"`;
    let args = opts.args || '';
    let normalizedNodePathEnvVar = normalizePathEnvVar(opts.nodePath);
    const nodePath = normalizedNodePathEnvVar.win32;
    const shNodePath = normalizedNodePathEnvVar.posix;
    let normalizedPrependPathEnvVar = normalizePathEnvVar(opts.prependToPath);
    const prependPath = normalizedPrependPathEnvVar.win32;
    const shPrependPath = normalizedPrependPathEnvVar.posix;
    if (!pwshProg) {
        pwshProg = quotedPathToTarget;
        args = '';
        shTarget = '';
    }
    else if (opts.prog === 'node' && opts.nodeExecPath) {
        pwshProg = `"${opts.nodeExecPath}"`;
        shTarget = quotedPathToTarget;
    }
    else {
        pwshLongProg = `"$basedir/${opts.prog}$exe"`;
        shTarget = quotedPathToTarget;
    }
    let progArgs = opts.progArgs ? `${opts.progArgs.join(` `)} ` : '';
    // #!/usr/bin/env pwsh
    // $basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent
    //
    // $ret=0
    // $exe = ""
    // if ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {
    //   # Fix case when both the Windows and Linux builds of Node
    //   # are installed in the same directory
    //   $exe = ".exe"
    // }
    // if (Test-Path "$basedir/node") {
    //   # Support pipeline input
    //   if ($MyInvocation.ExpectingInput) {
    //     $input | & "$basedir/node$exe" "$basedir/node_modules/npm/bin/npm-cli.js" $args
    //   } else {
    //     & "$basedir/node$exe" "$basedir/node_modules/npm/bin/npm-cli.js" $args
    //   }
    //   $ret=$LASTEXITCODE
    // } else {
    //   # Support pipeline input
    //   if ($MyInvocation.ExpectingInput) {
    //     $input | & "node$exe" "$basedir/node_modules/npm/bin/npm-cli.js" $args
    //   } else {
    //     & "node$exe" "$basedir/node_modules/npm/bin/npm-cli.js" $args
    //   }
    //   $ret=$LASTEXITCODE
    // }
    // exit $ret
    let pwsh = `\
#!/usr/bin/env pwsh
$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent

$exe=""
${(nodePath || prependPath) ? '$pathsep=":"\n' : ''}\
${nodePath ? `\
$env_node_path=$env:NODE_PATH
$new_node_path="${nodePath}"
` : ''}\
${prependPath ? `\
$env_path=$env:PATH
$prepend_path="${prependPath}"
` : ''}\
if ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {
  # Fix case when both the Windows and Linux builds of Node
  # are installed in the same directory
  $exe=".exe"
${(nodePath || prependPath) ? '  $pathsep=";"\n' : ''}\
}`;
    if (shNodePath || shPrependPath) {
        pwsh += `\
 else {
${shNodePath ? `  $new_node_path="${shNodePath}"\n` : ''}\
${shPrependPath ? `  $prepend_path="${shPrependPath}"\n` : ''}\
}
`;
    }
    if (shNodePath) {
        pwsh += `\
if ([string]::IsNullOrEmpty($env_node_path)) {
  $env:NODE_PATH=$new_node_path
} else {
  $env:NODE_PATH="$new_node_path$pathsep$env_node_path"
}
`;
    }
    if (opts.prependToPath) {
        pwsh += `
$env:PATH="$prepend_path$pathsep$env:PATH"
`;
    }
    if (pwshLongProg) {
        pwsh += `
$ret=0
if (Test-Path ${pwshLongProg}) {
  # Support pipeline input
  if ($MyInvocation.ExpectingInput) {
    $input | & ${pwshLongProg} ${args} ${shTarget} ${progArgs}$args
  } else {
    & ${pwshLongProg} ${args} ${shTarget} ${progArgs}$args
  }
  $ret=$LASTEXITCODE
} else {
  # Support pipeline input
  if ($MyInvocation.ExpectingInput) {
    $input | & ${pwshProg} ${args} ${shTarget} ${progArgs}$args
  } else {
    & ${pwshProg} ${args} ${shTarget} ${progArgs}$args
  }
  $ret=$LASTEXITCODE
}
${nodePath ? '$env:NODE_PATH=$env_node_path\n' : ''}\
${prependPath ? '$env:PATH=$env_path\n' : ''}\
exit $ret
`;
    }
    else {
        pwsh += `
# Support pipeline input
if ($MyInvocation.ExpectingInput) {
  $input | & ${pwshProg} ${args} ${shTarget} ${progArgs}$args
} else {
  & ${pwshProg} ${args} ${shTarget} ${progArgs}$args
}
${nodePath ? '$env:NODE_PATH=$env_node_path\n' : ''}\
${prependPath ? '$env:PATH=$env_path\n' : ''}\
exit $LASTEXITCODE
`;
    }
    return pwsh;
}
/**
 * Chmod just created shim and make it executable
 *
 * @param to Path to shim.
 */
function chmodShim(to, opts) {
    return opts.fs_.chmod(to, 0o755);
}
function normalizePathEnvVar(nodePath) {
    if (!nodePath || !nodePath.length) {
        return {
            win32: '',
            posix: ''
        };
    }
    let split = (typeof nodePath === 'string' ? nodePath.split(node_path__WEBPACK_IMPORTED_MODULE_0__.delimiter) : Array.from(nodePath));
    let result = {};
    for (let i = 0; i < split.length; i++) {
        const win32 = split[i].split('/').join('\\');
        const posix = isWindows ? split[i].split('\\').join('/').replace(/^([^:\\/]*):/, (_, $1) => `${isCygwin() ? '/proc/cygdrive' : '/mnt'}/${$1.toLowerCase()}`) : split[i];
        result.win32 = result.win32 ? `${result.win32};${win32}` : win32;
        result.posix = result.posix ? `${result.posix}:${posix}` : posix;
        result[i] = { win32, posix };
    }
    return result;
}
function shimTarget(src) {
    return `cmd-shim-target=${src.split('\\').join('/')}`;
}
//# sourceMappingURL=index.js.map

/***/ })

};
;