{brew} = require '../src/brew'
fs     = require 'fs'
path   = require 'path'

NUMBERS           = 100
TIME_TO_COMPRESS  = 10   # ms; simulate a slow compress
TIME_TO_JOIN      = 10   # ms; simulate a slow join
TIME_TO_COMPILE   = 10   # ms; simulate a slow compile
USE_LOGGER        = true # set to true to watch what brew is doing

# -----------------------------------------------------------------------------

assertCompressedText = (test_name, b, target, max_wait, cb) ->
  t = Date.now()
  while (b.getCompressedText() isnt target) and (Date.now() - t < max_wait)
    await setTimeout defer(), 10
  ct = b.getCompressedText()
  if ct isnt target
    console.log "#{test_name} failed; target = #{target}; actual = #{ct}"
    console.log b._fs_watchers
    console.log "Try setting USE_LOGGER=true to see what brew is doing."
    process.exit 1
  else
    console.log "#{test_name} passed after #{Date.now() - t}ms"
  cb()

# -----------------------------------------------------------------------------

nPath = (num) -> 
  if num % 2
    "#{__dirname}/cases/math/odds/#{num}.txt"
  else
    "#{__dirname}/cases/math/evens/#{num}.txt"

# -----------------------------------------------------------------------------

fullDeletionTest = (b, cb) ->
  console.log "STARTING DELETION TEST\n\n"

  for i in [0...NUMBERS]
    await fs.exists nPath(i), defer exists
    if exists
      await fs.unlink nPath(i), defer err
      if err? then console.log err

  await rmdir "#{__dirname}/cases/math/other/subdir", defer()

  await assertCompressedText "full deletion test", b, 0, 10000, defer()
  cb()

# -----------------------------------------------------------------------------

fullInsertionTest = (b, cb) ->
  console.log "STARTING INSERTION TEST\n\n"
  for i in [0...NUMBERS]
    await fs.writeFile nPath(i), i, defer err

  target = (NUMBERS) * (NUMBERS - 1) / 2

  await assertCompressedText "full insertion test", b, target, 10000, defer()
  cb()

# -----------------------------------------------------------------------------

subdirCreationTest = (b, cb) ->
  console.log "STARTING SUBDIR CREATION TEST\n\n"
  dirname = "#{__dirname}/cases/math/other/subdir"
  await
    fs.mkdir dirname, defer err
  if err
    console.log err
    process.exit 1  
  for i in [0...NUMBERS]
    await fs.writeFile "#{dirname}/#{i}.txt", i, defer err

  target = (NUMBERS) * (NUMBERS - 1) / 2
  await assertCompressedText "subdir creation test", b, target, 10000, defer()
  cb()

# -----------------------------------------------------------------------------

subdirDeletionTest = (b, cb) ->
  console.log "STARTING SUBDIR DELETION TEST\n\n"
  dirname = "#{__dirname}/cases/math/other/subdir"
  await rmdir dirname, defer()
  await assertCompressedText "subdir deletion test", b, 0, 10000, defer()
  cb()

# -----------------------------------------------------------------------------

myCompress = (str, cb) ->
  ###
  adds up all the numbers in a comma-separated string
  ###
  await setTimeout defer(), TIME_TO_COMPRESS
  nums = str.split ","
  sum  = 0
  if str.length then sum += parseInt n for n in nums
  cb null, sum

# -----------------------------------------------------------------------------

myJoin = (strs, cb) ->
  await setTimeout defer(), TIME_TO_JOIN
  cb null, strs.join ","

# -----------------------------------------------------------------------------

myCompile = (p, str, cb) ->
  await setTimeout defer(), TIME_TO_COMPILE
  cb null, str

# -----------------------------------------------------------------------------

rmdir = (dir, cb) ->
  await fs.readdir dir, defer err, list
  if not err
    for f in list
      filename = path.join dir, f
      await fs.stat filename, defer err, stat
      if not (f in ['.','..'])
        if stat.isDirectory()
          await rmdir filename, defer()
        else
          await fs.unlink filename, defer err
    await fs.rmdir dir, defer()
  cb()

# -----------------------------------------------------------------------------


await b = new brew {
  includes: ["./cases/math/"]
  excludes: []
  match:      /^.*.txt$/
  join:       (strs, cb)      -> myJoin strs, cb
  compress:   (str, cb)       -> myCompress str, cb
  compile:    (p, str, cb)    -> myCompile p, str, cb
  logger:     (line)          -> if USE_LOGGER then console.log "brew speaks: #{line}"
  onReady:                       defer vh, txt, ctxt
  onChange: (vh, txt, ctxt)   -> console.log "change: [#{vh}] #{txt} -> #{ctxt}"
}

d = Date.now()

await fullDeletionTest    b, defer()
await fullInsertionTest   b, defer()
await fullDeletionTest    b, defer()
await fullDeletionTest    b, defer()
await fullInsertionTest   b, defer()
await fullDeletionTest    b, defer()
await subdirCreationTest  b, defer()
await subdirDeletionTest  b, defer()
await fullDeletionTest    b, defer()

console.log "\n\n\nSUCCESS; total time = #{Date.now() - d}ms\n\n\n"
process.exit 1

