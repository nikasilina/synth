const state = {
context: null,
master: null,
compressor: null,
mono: null,
analyser: null,
impulse: null,
voices: [
{ wave: 'triangle', volume: .72, detune: 0, attack: .08, release: .45, pan: -.35, node: null },
{ wave: 'sine', volume: .68, detune: 7, attack: .16, release: .75, pan: .35, node: null }
],
effects: { delay: true, reverb: true, chorus: true, autopan: true },
effectValues: { delay: .28, reverb: .22, chorus: .12, autopan: .35 },
drumLoops: { kick: null, snare: null, hat: null, clap: null },
sequenceTimer: null,
step: 0,
outputMode: 'stereo'
}

const NOTES = {
C3: 130.81, D3: 146.83, E3: 164.81, G3: 196, A3: 220,
C4: 261.63, D4: 293.66, E4: 329.63, G4: 392, A4: 440
}
const PATTERN = [
['C3', 'G3'], ['E3', 'A3'], ['G3', 'D4'], ['A3', 'E4'],
['C4', 'G3'], ['E3', 'D4'], ['G3', 'A3'], ['D3', 'E4']
]

function ensureAudio() {
if (state.context) {
if (state.context.state === 'suspended') state.context.resume()
return
}

const AudioCtx = window.AudioContext || window.webkitAudioContext
const ctx = new AudioCtx()
state.context = ctx
ctx.resume()
state.master = ctx.createGain()
state.master.gain.value = Number(document.querySelector('#masterVolume').value) * .72
state.compressor = ctx.createDynamicsCompressor()
state.compressor.threshold.value = -18
state.compressor.knee.value = 18
state.compressor.ratio.value = 4
state.compressor.attack.value = .012
state.compressor.release.value = .28
state.mono = ctx.createChannelMerger(2)
state.analyser = ctx.createAnalyser()
state.analyser.fftSize = 256
state.master.connect(state.compressor).connect(state.analyser).connect(ctx.destination)
state.impulse = createImpulse(ctx, 1.25, 3)
}

function createImpulse(ctx, duration = 1.5, decay = 2.3) {
const length = ctx.sampleRate * duration
const impulse = ctx.createBuffer(2, length, ctx.sampleRate)
for (let c = 0; c < 2; c += 1) {
const data = impulse.getChannelData(c)
for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay)
}
return impulse
}

function smoothParam(param, value, duration = .08) {
if (!state.context) return
const now = state.context.currentTime
const current = Number.isFinite(param.value) ? param.value : value
param.cancelScheduledValues(now)
param.setValueAtTime(current, now)
param.linearRampToValueAtTime(value, now + duration)
}

function restoreMaster() {
if (!state.master || !state.context || state.master.gain.value > .001) return
const volume = Number(document.querySelector('#masterVolume').value) * .72
const now = state.context.currentTime
state.master.gain.cancelScheduledValues(now)
state.master.gain.setValueAtTime(volume, now)
}

function makeVoice(index, frequency) {
ensureAudio()
restoreMaster()
const ctx = state.context
const config = state.voices[index]
const now = ctx.currentTime
if (!config.node) {
const oscillator = ctx.createOscillator()
const envelope = ctx.createGain()
const level = ctx.createGain()
const panner = ctx.createStereoPanner()
const delay = ctx.createDelay(1)
const delayWet = ctx.createGain()
const convolver = ctx.createConvolver()
const reverbWet = ctx.createGain()
const chorusDelay = ctx.createDelay(.05)
const chorusWet = ctx.createGain()
const chorusLfo = ctx.createOscillator()
const chorusDepth = ctx.createGain()
const panLfo = ctx.createOscillator()
const panDepth = ctx.createGain()

oscillator.type = config.wave
oscillator.frequency.value = frequency
oscillator.detune.value = config.detune
envelope.gain.value = .0001
level.gain.value = config.volume * .62
panner.pan.value = state.outputMode === 'mono' ? 0 : config.pan
chorusDelay.delayTime.value = .018
chorusWet.gain.value = state.effects.chorus ? .2 : 0
chorusLfo.frequency.value = .32
chorusDepth.gain.value = .001 + state.effectValues.chorus * .006
delay.delayTime.value = .08 + state.effectValues.delay * .42
delayWet.gain.value = state.effects.delay ? .12 + state.effectValues.delay * .22 : 0
convolver.buffer = state.impulse
reverbWet.gain.value = state.effects.reverb ? state.effectValues.reverb * .9 : 0
panLfo.frequency.value = .12 + state.effectValues.autopan * .7
panDepth.gain.value = state.outputMode === 'stereo' && state.effects.autopan ? .18 : 0

oscillator.connect(envelope).connect(level).connect(panner).connect(state.master)
panner.connect(chorusDelay).connect(chorusWet).connect(state.master)
chorusLfo.connect(chorusDepth).connect(chorusDelay.delayTime)
panner.connect(delay).connect(delayWet).connect(state.master)
panner.connect(convolver).connect(reverbWet).connect(state.master)
panLfo.connect(panDepth).connect(panner.pan)
oscillator.start(now)
panLfo.start(now)
chorusLfo.start(now)
config.node = { oscillator, envelope, level, panner, delay, delayWet, reverbWet, chorusDelay, chorusWet, chorusLfo, chorusDepth, panLfo, panDepth }
}

const { oscillator, envelope, panner } = config.node
oscillator.type = config.wave
oscillator.frequency.cancelAndHoldAtTime(now)
oscillator.frequency.setTargetAtTime(frequency, now, .018)
oscillator.detune.cancelAndHoldAtTime(now)
oscillator.detune.setTargetAtTime(config.detune, now, .04)
panner.pan.cancelAndHoldAtTime(now)
panner.pan.setTargetAtTime(state.outputMode === 'mono' ? 0 : config.pan, now, .08)
envelope.gain.cancelAndHoldAtTime(now)
envelope.gain.exponentialRampToValueAtTime(
1,
now + Math.max(.1, config.attack)
)
}

function stopVoice(index, fast = false) {
const voice = state.voices[index]
if (!voice.node || !state.context) return
const now = state.context.currentTime
const { envelope } = voice.node
envelope.gain.cancelAndHoldAtTime(now)
const release = fast ? .06 : Math.max(.55, voice.release)
envelope.gain.exponentialRampToValueAtTime(.0001, now + release)
}

function stopEverything() {
Object.keys(state.drumLoops).forEach(type => {
if (state.drumLoops[type]) window.clearInterval(state.drumLoops[type])
state.drumLoops[type] = null
const button = document.querySelector(`[data-drum="${type}"]`)
button.classList.remove('is-looping', 'is-hit')
button.setAttribute('aria-pressed', 'false')
})
stopVoice(0, true)
stopVoice(1, true)
if (state.master && state.context) smoothParam(state.master.gain, .0001, .06)
}

function playPad(index, pointer) {
const pad = document.querySelector(`[data-pad="${index}"]`)
const rect = pad?.getBoundingClientRect()
const y = pointer && rect ? Math.max(0, Math.min(1, (pointer.clientY - rect.top) / rect.height)) : .5
const scale = index === 0 ? ['C3', 'D3', 'E3', 'G3', 'A3'] : ['G3', 'A3', 'C4', 'D4', 'E4']
const note = scale[Math.min(scale.length - 1, Math.floor((1 - y) * scale.length))]
if (pad) {
pad.querySelector('.touch-pad__note').textContent = note
pad.classList.add('is-active')
}
makeVoice(index, NOTES[note])
}

function releasePad(index) {
document.querySelector(`[data-pad="${index}"]`)?.classList.remove('is-active')
stopVoice(index)
}

function noiseBuffer(seconds = .2) {
const ctx = state.context
const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate)
const data = buffer.getChannelData(0)
for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1
return buffer
}

function hitDrum(type) {
ensureAudio()
restoreMaster()
const ctx = state.context
const now = ctx.currentTime
const gain = ctx.createGain()
const pan = ctx.createStereoPanner()
pan.pan.value = state.outputMode === 'mono' ? 0 : ({ kick: 0, snare: -.25, hat: .45, clap: -.5 }[type])
gain.connect(pan).connect(state.master)

if (type === 'kick') {
const osc = ctx.createOscillator()
osc.frequency.setValueAtTime(150, now)
osc.frequency.exponentialRampToValueAtTime(45, now + .22)
gain.gain.setValueAtTime(.85, now)
gain.gain.exponentialRampToValueAtTime(.001, now + .35)
osc.connect(gain); osc.start(now); osc.stop(now + .36)
} else {
const source = ctx.createBufferSource()
const filter = ctx.createBiquadFilter()
source.buffer = noiseBuffer(type === 'clap' ? .35 : .18)
filter.type = type === 'hat' ? 'highpass' : 'bandpass'
filter.frequency.value = type === 'hat' ? 6500 : type === 'clap' ? 1350 : 1700
gain.gain.setValueAtTime(type === 'hat' ? .22 : type === 'clap' ? .48 : .34, now)
if (type === 'clap') {
gain.gain.exponentialRampToValueAtTime(.035, now + .035)
gain.gain.setValueAtTime(.42, now + .052)
gain.gain.exponentialRampToValueAtTime(.025, now + .09)
gain.gain.setValueAtTime(.32, now + .108)
}
gain.gain.exponentialRampToValueAtTime(.001, now + (type === 'clap' ? .32 : .17))
source.connect(filter).connect(gain); source.start(now)
}
const button = document.querySelector(`[data-drum="${type}"]`)
button.classList.add('is-hit')
window.setTimeout(() => button.classList.remove('is-hit'), 120)
}

function toggleDrum(type) {
const button = document.querySelector(`[data-drum="${type}"]`)
const activeLoop = state.drumLoops[type]

if (activeLoop) {
window.clearInterval(activeLoop)
state.drumLoops[type] = null
button.classList.remove('is-looping')
button.setAttribute('aria-pressed', 'false')
return
}

ensureAudio()
hitDrum(type)
const intervals = { kick: 1250, snare: 1250, hat: 312.5, clap: 1250 }
state.drumLoops[type] = window.setInterval(() => hitDrum(type), intervals[type])
button.classList.add('is-looping')
button.setAttribute('aria-pressed', 'true')
}

function sequenceStep() {
const pair = PATTERN[state.step % PATTERN.length]
makeVoice(0, NOTES[pair[0]])
makeVoice(1, NOTES[pair[1]])
if (state.step % 8 === 0) hitDrum('kick')
if (state.step % 8 === 4) hitDrum('snare')
if (state.step % 8 === 2) hitDrum('hat')
if (state.step % 8 === 6) hitDrum('clap')
document.querySelectorAll('.touch-pad').forEach((pad, index) => {
pad.querySelector('.touch-pad__note').textContent = pair[index]
pad.classList.add('is-active')
window.setTimeout(() => { pad.classList.remove('is-active'); stopVoice(index) }, stepDuration() * .72)
})
state.step += 1
}

function stepDuration() { return 60000 / 88 }

function toggleSequence(forceStop = false) {
ensureAudio()
const button = document.querySelector('#playButton')
if (state.sequenceTimer || forceStop) {
window.clearInterval(state.sequenceTimer)
state.sequenceTimer = null
button.classList.remove('is-playing')
button.setAttribute('aria-pressed', 'false')
button.textContent = 'START'
stopEverything()
if (forceStop) return
} else {
smoothParam(state.master.gain, Number(document.querySelector('#masterVolume').value) * .72, .08)
state.step = 0
sequenceStep()
state.sequenceTimer = window.setInterval(sequenceStep, stepDuration())
button.classList.add('is-playing')
button.setAttribute('aria-pressed', 'true')
button.textContent = 'STOP'
}
}

function formatValue(param, value) {
if (param === 'volume') return Math.round(value * 100)
if (param === 'pan') return Math.abs(value) < .02 ? 'C' : `${value < 0 ? 'L' : 'R'} ${Math.round(Math.abs(value) * 100)}`
if (param === 'detune') return value > 0 ? `+${value}` : value
return Number(value).toFixed(2)
}

function drawMeter() {
if (!state.analyser) return
const data = new Uint8Array(state.analyser.frequencyBinCount)
state.analyser.getByteFrequencyData(data)
const level = data.reduce((sum, n) => sum + n, 0) / data.length
document.querySelector('#levelText').textContent = level < 1 ? '−∞ dB' : `${Math.round(-48 + level / 255 * 48)} dB`
requestAnimationFrame(drawMeter)
}

document.querySelectorAll('.voice').forEach((panel, index) => {
panel.querySelectorAll('[data-param]').forEach(input => {
input.addEventListener('input', () => {
const param = input.dataset.param
const value = Number(input.value)
const voice = state.voices[index]
voice[param] = value

if (!voice.node || !state.context) return
if (param === 'pan') {
const target = state.outputMode === 'mono' ? 0 : value
smoothParam(voice.node.panner.pan, target, .1)
}
if (param === 'detune') {
smoothParam(voice.node.oscillator.detune, value, .08)
}
if (param === 'volume') {
smoothParam(voice.node.level.gain, value * .62, .1)
}
})
})
panel.querySelectorAll('[data-wave]').forEach(button => {
button.addEventListener('click', () => {
panel.querySelectorAll('[data-wave]').forEach(item => item.classList.remove('is-active'))
button.classList.add('is-active')
state.voices[index].wave = button.dataset.wave
if (state.voices[index].node) state.voices[index].node.oscillator.type = button.dataset.wave
})
})
})

document.querySelectorAll('[data-pad]').forEach((pad, index) => {
pad.addEventListener('pointerdown', event => { pad.setPointerCapture(event.pointerId); playPad(index, event) })
pad.addEventListener('pointermove', event => { if (pad.hasPointerCapture(event.pointerId)) playPad(index, event) })
pad.addEventListener('pointerup', () => releasePad(index))
pad.addEventListener('pointercancel', () => releasePad(index))
})

document.querySelectorAll('[data-drum]').forEach(button => {
button.setAttribute('aria-pressed', 'false')
button.addEventListener('click', () => toggleDrum(button.dataset.drum))
})
document.querySelector('#playButton').addEventListener('click', () => toggleSequence())
document.querySelector('#masterVolume').addEventListener('input', event => {
const value = Number(event.target.value)
if (state.master) state.master.gain.setTargetAtTime(value * .72, state.context.currentTime, .04)
})

document.querySelectorAll('.effect').forEach(effect => {
const name = effect.dataset.effect
const button = effect.querySelector('button')
const range = effect.querySelector('input')
button.addEventListener('click', () => {
state.effects[name] = !state.effects[name]
button.classList.toggle('is-active', state.effects[name])
button.setAttribute('aria-pressed', String(state.effects[name]))
if (!state.context) return
const now = state.context.currentTime
state.voices.forEach(voice => {
if (!voice.node) return
if (name === 'delay') {
const wet = state.effects.delay ? .12 + state.effectValues.delay * .22 : 0
voice.node.delayWet.gain.setTargetAtTime(wet, now, .06)
}
if (name === 'reverb') {
const wet = state.effects.reverb ? state.effectValues.reverb * .9 : 0
voice.node.reverbWet.gain.setTargetAtTime(wet, now, .08)
}
if (name === 'chorus') {
voice.node.chorusWet.gain.setTargetAtTime(state.effects.chorus ? .2 : 0, now, .08)
}
if (name === 'autopan' && voice.node.panDepth) {
voice.node.panDepth.gain.setTargetAtTime(state.effects.autopan ? .18 : 0, now, .08)
}
})
})
range.addEventListener('input', () => {
const value = Number(range.value)
state.effectValues[name] = value
if (!state.context) return
const now = state.context.currentTime
state.voices.forEach(voice => {
if (!voice.node) return
if (name === 'delay') {
voice.node.delay.delayTime.setTargetAtTime(.08 + value * .42, now, .08)
if (state.effects.delay) voice.node.delayWet.gain.setTargetAtTime(.12 + value * .22, now, .06)
}
if (name === 'reverb' && state.effects.reverb) {
voice.node.reverbWet.gain.setTargetAtTime(value * .9, now, .08)
}
if (name === 'chorus') {
voice.node.chorusDepth.gain.setTargetAtTime(.001 + value * .006, now, .1)
if (state.effects.chorus) voice.node.chorusWet.gain.setTargetAtTime(.12 + value * .35, now, .1)
}
if (name === 'autopan' && voice.node.panLfo) {
voice.node.panLfo.frequency.setTargetAtTime(.12 + value * .7, now, .08)
}
})
})
})

document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
state.outputMode = button.dataset.mode
document.querySelectorAll('[data-mode]').forEach(item => item.classList.toggle('is-active', item === button))
if (!state.context) return
const now = state.context.currentTime
state.voices.forEach(voice => {
if (!voice.node) return
voice.node.panner.pan.setTargetAtTime(state.outputMode === 'mono' ? 0 : voice.pan, now, .08)
if (voice.node.panDepth) voice.node.panDepth.gain.setTargetAtTime(state.outputMode === 'stereo' && state.effects.autopan ? .18 : 0, now, .08)
})
}))

const keyMap = { q: 'kick', w: 'snare', e: 'hat', r: 'clap' }
document.addEventListener('keydown', event => {
if (event.repeat || event.target.matches('input')) return
const key = event.key.toLowerCase()
if (keyMap[key]) hitDrum(keyMap[key])
if (key === 'a') playPad(0)
if (key === 's') playPad(1)
})
document.addEventListener('keyup', event => {
const key = event.key.toLowerCase()
if (key === 'a') releasePad(0)
if (key === 's') releasePad(1)
})
