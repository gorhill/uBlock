{spawn, exec}  = require 'child_process'
fs             = require 'fs'

task 'build', 'build the whole jam', (cb) ->  
  console.log "Building"
  files = fs.readdirSync 'src'
  files = ('src/' + file for file in files when file.match(/\.coffee$/))
  clearLibJs ->
    runIced ['-I', 'inline', '-c', '-o', 'lib/'].concat(files), ->
      runIced ['-I', 'inline', '-c', 'index.coffee'], ->
        console.log "Done building."
        cb() if typeof cb is 'function'


runIced = (args, cb) ->
  proc =  spawn 'iced', args
  console.log args
  proc.stderr.on 'data', (buffer) -> console.log buffer.toString()
  proc.on        'exit', (status) ->
    process.exit(1) if status != 0
    cb() if typeof cb is 'function'

clearLibJs = (cb) ->
  files = fs.readdirSync 'lib'
  files = ("lib/#{file}" for file in files when file.match(/\.js$/))
  fs.unlinkSync f for f in files
  cb()
