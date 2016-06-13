fs            = require 'fs'
path          = require 'path'
crypto        = require 'crypto'

class brew
  constructor: (o) ->
    ###
    o (dict argument): 
      includes:   a sorted list of files and/or dirs to include
      excludes:   (optional) any exceptions (files and/or dirs) to the includes
      match:      (optional) a regular expression any file must match; say if you want to limit to extensions
      compile:    (optional) fn to call on each file's contents; takes (filename, str, cb) as arguments; if missing, just returns text
      join:       (optional) fn takes all the (sorted) compiled strings and joins them together for final output
      compress:   (optional) fn that takes final output str and combines together into a new compressed string
      onChange:   (optional) a callback when anything changes in the brew. takes (passes version_hash, txt) as argument
      onReady:    (optional) a callback for when the first compilation pass is done and the brew is ready
      logger:     (optional) a function that handles lines of logs
      loop_delay: (optional) time in ms between checking for filesystem changes
      change_triggers: (optional) an array of pairs of regexps, where the first item is a regexp matching trigger files, and the second matches target files
        if a file matching the first regexp changes (the source or the compilation), it will trigger
          a recompile of any known file matching the righthand regexp, even if that file hasn't changed.
          for example: [/styl\/colors.styl^\/, \/styl\/.*.styl^/] recompiles everything in the styl directory if colors.styl changes
    ###
    @_includes          = (path.resolve(p) for p in (o.includes  or []))
    @_excludes          = (path.resolve(p) for p in (o.excludes  or []))
    @_match             = o.match           or /.*/
    @_compile           = o.compile         or        (p, str, cb) -> cb null, str
    @_join              = o.join            or          (strs, cb) -> cb null, strs.join "\n"
    @_compress          = o.compress        or null
    @_onChange          = o.onChange        or (version_hash, txt, compressed_txt) ->
    @_onReady           = o.onReady         or (version_hash, txt, compressed_txt) ->
    @_logger            = o.logger          or null
    @_loop_delay        = o.loop_delay      or 500
    @_change_triggers   = o.change_triggers or []
    @_versionHash       = null
    @_txt               = null
    @_compressed_txt    = null
    @_files             = {} # keyed by full paths to files; points to file class objects
    @_ready_yet         = false
    @_alive             = true

    await @_fullPass defer()
    await @_flipToNewContent defer()

    @_ready_yet         = true

    if o.onReady?
      o.onReady @getVersionHash(), @getCompiledText(), @getCompressedText()

    @_monitorLoop()

  isReady: -> @_versionHash? and @_txt?

  getVersionHash:  -> 
    if not @isReady()
      throw new Error "getVersionHash() called before onReady(); wait for your brew to brew or check isReady()!"
    @_versionHash

  getCompiledText: -> 
    if not @isReady()
      throw new Error "getCompiledText() called before onReady(); wait for your brew to brew or check isReady()!"  
    @_txt

  getCompressedText: ->
    if not (@_versionHash? and @_compressed_txt?)
      throw new Error "getCompressedText() called before onReady(); wait for your brew to brew!" 
    if not @_compress?
      @_log "requested compressed text, but not compress fn provided; returning regular text"
      return @_txt
    return @_compressed_txt

  kill: ->
    @_alive = false

  # --------------- PRIVATE PARTY BELOW ---------------------------------------

  _log: (str) => if @_logger? then @_logger str

  _fullPass: (cb) ->
    any_changes = false
    for p, i in @_includes
      await @_recurse p, i, defer changes
      any_changes = any_changes or changes
    cb any_changes

  _checkKnownFiles: (cb) ->
    any_changes = false
    for p, file of @_files
      await @_possiblyReload p, file, defer err, changes
      if err
        delete @_files[p]
      any_changes = any_changes or changes
    cb any_changes

  _monitorLoop: ->

    d = Date.now()

    # 1. check existing known files
    await @_checkKnownFiles defer changes_1

    # 2. iterate across requested includes
    await @_fullPass defer changes_2

    # 3. if anything changed, re-join
    if changes_1 or changes_2
      await @_flipToNewContent defer any_final_changes

    if any_final_changes
      @_log "[#{Date.now() - d}ms] flipToNewContent: (#{@_versionHash})"

    # if we haven't killed the monitor loop
    if @_alive
      setTimeout (=> @_monitorLoop()), @_loop_delay

  _flipToNewContent: (cb) ->
    ###
    puts together all the compilations
    and generates a new version number
    ###
    paths = (fp for fp, f of @_files when f.isOk())
    paths.sort (a,b) => @_files[a].getPriority() - @_files[b].getPriority()
    txts = []
    for fp in paths
      txts.push @_files[fp].getCompiledText()
    await @_join txts, defer err, res
    if res isnt @_txt
      if @_compress?
        await @_compress res, defer err, cres
        @_compressed_txt = cres
      @_txt         = res
      @_versionHash = crypto.createHash('md5').update("#{@_txt}").digest('hex')[0...8]
      if @_ready_yet
        @_onChange @_versionHash, @_txt, @getCompressedText()
      any_changes = true
    else
      any_changes = false
    cb any_changes

  _recurse: (p, priority, cb) ->
    ###
    p:  a file or directory
    cb: true if anything has changed
    ###
    any_changes = false
    if not (p in @_excludes)
      await fs.stat p, defer err, stat
      if not err
        if stat.isDirectory()
          await fs.readdir p, defer err, files
          if not err
            for f in files
              fp = path.join p, f          
              await @_recurse fp, priority, defer changes
              any_changes = any_changes or changes
        else if stat.isFile()
          if path.basename(p).match @_match
            await @_recurseHandleFile p, priority, defer changes
            any_changes = any_changes or changes
      else
        # perhaps this path does not exist;
        if @_files[p]?
          delete @_files[p]
          @_log "removing #{p} from files; it went missing"
          any_changes = true
    cb any_changes

  _recurseHandleFile: (p, priority, cb) ->
    did_reload = false
    if not @_files[p]?
      @_files[p] = new file p, priority, @_log
      await @_possiblyReload p, @_files[p], defer err, did_reload
    else
      @_files[p].setPriority Math.min priority, @_files[p].getPriority()    
    cb did_reload

  _possiblyReload: (p, f, cb) ->
    await f.possiblyReload @_compile, defer err, did_reload
    if did_reload 
      # hande any triggered recompiles
      for ct in @_change_triggers
        if p.match ct[0]
          if f.isOk()
            for p2, f2 of @_files when f2 isnt f
              if p2.match ct[1]
                await f2.reload @_compile, true, defer f2_reloaded
                if f2_reloaded
                  @_log "#{p} triggered a recompile of #{p2}"
          else
            @_log "#{p} isn't ok, so change trigger ignored"
    cb err, did_reload

# -----------------------------------------------------------------------------

class file
  constructor: (p, priority, log_fn) ->
    ###
      p = path
      pri = 0, 1, etc. (0 is lowest)
    ###
    @_log             = log_fn or ->
    @_path            = p
    @_priority        = priority
    @_src_txt         = null
    @_compiled_txt    = null
    @_err             = null
    @_lastChecked     = null

  reload: (compile_fn, force, cb) ->
    ###
      if force is set to true, then the 
      file will be recompiled even if the src
      is unchanged; this makes sense if we know the
      file depends on something else which has changed,
      say an import in a .styl file
    ###

    now               = Date.now()
    old_src_txt       = @_src_txt
    old_compiled_txt  = @_compiled_txt 
    await fs.readFile @_path, "utf8", defer @_err, data
    if not @_err
      if (data isnt @_src_txt) or force
        @_src_txt = data
        await compile_fn @_path, @_src_txt, defer err, @_compiled_txt
      src_changed       = @_src_txt       isnt old_src_txt
      compiled_changed  = @_compiled_txt  isnt old_compiled_txt
      reloaded          = src_changed or compiled_changed
      if reloaded
        @_log "[#{Date.now() - now}ms] #{@_path} changed; src changed: #{src_changed} | compiled changed: #{compiled_changed}"
      @_lastChecked = now
    else
      @_log "Error reading file: #{@_path} - counting as reload"
      reloaded = true
    cb reloaded

  possiblyReload: (compile_fn, cb) ->
    reloaded  = false
    await fs.stat @_path, defer @_err, stat
    if not @_err
      changed = Math.max(stat.mtime.getTime(), stat.ctime.getTime())
      if changed >= @_lastChecked - 1000 # changed might be rounded down by OS
        await @reload compile_fn, false, defer reloaded
    if @_err
      reloaded = true
    cb @_err, reloaded

  isOk:               -> not @_err 
  getCompiledText:    -> @_compiled_txt
  getSrc:             -> @_src
  getPriority:        -> @_priority
  setPriority: (pri)  -> @_priority = pri
  getPath:            -> @_path

# -----------------------------------------------------------------------------

exports.brew = brew
