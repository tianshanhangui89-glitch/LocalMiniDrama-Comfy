<template>
  <section class="audio-editor">
    <input ref="fileInput" class="hidden" type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm" @change="onFile" />
    <div v-if="!source" class="drop" @click="fileInput?.click()" @dragover.prevent @drop.prevent="dropFile">
      <span class="upload-icon">⇧</span><b>{{ uploading ? '正在上传音频…' : '将音频拖放到此处' }}</b><span>- 或 -</span><strong>点击上传</strong><small>原始文件不限大小；仅裁剪出的 ≤15 秒片段用于克隆</small>
    </div>
    <div v-else class="player">
      <header><span>♫　参考音频（必填）</span><button title="移除" @click="clear">×</button></header>
      <div ref="waveWrap" class="wave-wrap" @pointerdown="waveDown" @pointermove="waveMove" @pointerup="waveUp" @pointercancel="waveUp"><canvas ref="canvas"></canvas><div class="selection" :style="selectionStyle"><i class="handle left"></i><i class="handle right"></i></div><div class="playhead" :style="playheadStyle"></div></div>
      <div class="times"><span>{{ format(currentTime) }}</span><span>{{ format(duration) }}</span></div>
      <input class="seek" type="range" min="0" :max="duration || 1" step="0.01" :value="currentTime" @input="seek" />
      <div class="controls"><label>倍速 <select v-model.number="rate"><option :value="0.75">0.75×</option><option :value="1">1×</option><option :value="1.25">1.25×</option><option :value="1.5">1.5×</option><option :value="2">2×</option></select></label><button @click="skip(-5)">◀◀</button><button class="play" @click="toggle">{{ playing ? '❚❚' : '▶' }}</button><button @click="skip(5)">▶▶</button><button class="scissors" title="按当前波形选区剪切" :disabled="cutting" @click="cut">✂</button></div>
      <div class="trim"><div><label>选区开始　{{ start.toFixed(1) }} 秒</label><input v-model.number="start" type="range" min="0" :max="Math.max(0, end - 0.1)" step="0.1" /></div><div><label>选区结束　{{ end.toFixed(1) }} 秒 <em>（最长 15 秒）</em></label><input v-model.number="end" type="range" :min="Math.min(duration, start + 0.1)" :max="Math.min(duration, start + 15)" step="0.1" /></div><button class="cut" :disabled="cutting" @click="cut">{{ cutting ? '正在剪切…' : `剪切 ${clipLength.toFixed(1)} 秒并试听` }}</button></div>
      <audio ref="audio" :src="source.url" @loadedmetadata="loaded" @timeupdate="timeupdate" @play="playing=true" @pause="playing=false" @ended="playing=false"></audio>
    </div>
    <div v-if="preview" class="preview"><span>剪切预览</span><audio :src="preview.url" controls></audio><button @click="choose(preview)">使用此片段</button></div>
    <div v-if="savedVoices.length" class="saved"><small>已保存的自定义音色</small><button v-for="voice in savedVoices" :key="voice.path" :class="{ selected: voice.path === selectedPath }" @click="choose(voice)">{{ voice.label }}</button></div>
  </section>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { freeCreateAPI } from '@/api/freeCreate'

const props = defineProps({ savedVoices: { type: Array, default: () => [] }, selectedPath: { type: String, default: '' } })
const emit = defineEmits(['select', 'saved'])
const fileInput = ref(), canvas = ref(), audio = ref(), waveWrap = ref(), source = ref(null), preview = ref(null), uploading = ref(false), cutting = ref(false), duration = ref(0), currentTime = ref(0), playing = ref(false), rate = ref(1), start = ref(0), end = ref(10), dragMode = ref(''), playSelection = ref(false)
const clipLength = computed(() => Math.max(.1, end.value - start.value))
const selectionStyle = computed(() => ({ left: `${duration.value ? start.value / duration.value * 100 : 0}%`, width: `${duration.value ? clipLength.value / duration.value * 100 : 0}%` }))
const playheadStyle = computed(() => ({ left: `${duration.value ? currentTime.value / duration.value * 100 : 0}%` }))
watch(rate, v => { if (audio.value) audio.value.playbackRate = v })
function format(v) { v = Number(v) || 0; return `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}` }
function loaded() { duration.value = audio.value?.duration || 0; end.value = Math.min(10, duration.value || 10); nextTick(draw) }
function timeupdate() { currentTime.value = audio.value?.currentTime || 0; if (playSelection.value && currentTime.value >= end.value) { audio.value.pause(); audio.value.currentTime = end.value; playSelection.value = false } }
function seek(e) { if (audio.value) audio.value.currentTime = Number(e.target.value) }
function waveTime(e) { const rect = waveWrap.value?.getBoundingClientRect(); return rect && duration.value ? Math.max(0, Math.min(duration.value, (e.clientX - rect.left) / rect.width * duration.value)) : 0 }
function waveDown(e) { if (!duration.value) return; e.currentTarget.setPointerCapture?.(e.pointerId); const t = waveTime(e), edge = Math.max(.25, duration.value * .018); dragMode.value = Math.abs(t - start.value) < edge ? 'start' : Math.abs(t - end.value) < edge ? 'end' : 'new'; if (dragMode.value === 'new') { start.value = t; end.value = Math.min(duration.value, t + 10, t + 15); audio.value.currentTime = t } }
function waveMove(e) { if (!dragMode.value) return; const t = waveTime(e); if (dragMode.value === 'start') start.value = Math.min(t, end.value - .1); else if (dragMode.value === 'end') end.value = Math.max(start.value + .1, Math.min(t, start.value + 15)); else end.value = Math.max(start.value + .1, Math.min(t, start.value + 15)) }
function waveUp() { dragMode.value = '' }
function skip(s) { if (audio.value) audio.value.currentTime = Math.max(0, Math.min(duration.value, audio.value.currentTime + s)) }
function toggle() { if (!audio.value) return; if (!audio.value.paused) { audio.value.pause(); return } if (audio.value.currentTime < start.value || audio.value.currentTime >= end.value) audio.value.currentTime = start.value; playSelection.value = true; audio.value.play() }
async function draw() { try { const c = canvas.value; if (!c || !source.value) return; const rect = c.getBoundingClientRect(), dpr = devicePixelRatio || 1; c.width = rect.width * dpr; c.height = rect.height * dpr; const ctx = c.getContext('2d'); ctx.scale(dpr, dpr); const ac = new (window.AudioContext || window.webkitAudioContext)(); const b = await (await fetch(source.value.url)).arrayBuffer(); const data = (await ac.decodeAudioData(b)).getChannelData(0); const w = rect.width, h = rect.height, step = Math.ceil(data.length / w); ctx.clearRect(0,0,w,h); ctx.strokeStyle = '#b7c1d2'; ctx.lineWidth = 1.5; for(let x=0;x<w;x++){let min=1,max=-1;for(let j=0;j<step;j++){const v=data[x*step+j]||0; if(v<min)min=v;if(v>max)max=v}ctx.beginPath();ctx.moveTo(x,(1+min)*h/2);ctx.lineTo(x,(1+max)*h/2);ctx.stroke()} ac.close() } catch (_) {} }
async function upload(file) { uploading.value = true; try { source.value = await freeCreateAPI.uploadVoice(file); preview.value = null; currentTime.value = start.value = 0; ElMessage.success('上传完成，可播放并拖动选择剪切范围') } finally { uploading.value = false } }
function onFile(e) { const f = e.target.files?.[0]; if (f) upload(f) }
function dropFile(e) { const f = e.dataTransfer?.files?.[0]; if (f) upload(f) }
function clear() { if(audio.value) audio.value.pause(); source.value = null; preview.value = null; duration.value = 0 }
async function cut() { if (!source.value) return; cutting.value = true; try { let save = false, name = ''; try { await ElMessageBox.confirm('是否保存这个自定义音色，以后继续使用？', '剪切完成后', { confirmButtonText: '保存并命名', cancelButtonText: '仅本次使用', distinguishCancelAndClose: true }); save = true; name = (await ElMessageBox.prompt('请输入音色名称', '保存音色')).value.trim() } catch (_) { save = false } const voice = await freeCreateAPI.trimVoice({ path: source.value.path, start: start.value, duration: clipLength.value, save, name }); preview.value = voice; if (voice.saved) emit('saved'); ElMessage.success(voice.saved ? '音色已保存' : '片段已就绪，仅本次使用') } finally { cutting.value = false } }
function choose(voice) { emit('select', voice); ElMessage.success(`已选择：${voice.label}`) }
</script>

<style scoped>
.audio-editor{padding-top:12px}.hidden{display:none}.drop{height:250px;border:1px dashed #526277;border-radius:8px;background:#202126;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#e9edf5;cursor:pointer}.drop:hover{border-color:#ff8a22}.upload-icon{font-size:36px}.drop b{font-size:18px}.drop span,.drop small{color:#a4adbd}.drop strong{font-size:16px}.player{position:relative;border:1px solid #454d5b;border-radius:8px;background:#202126;padding:48px 20px 16px}.player header{position:absolute;top:0;left:0;right:0;height:40px;border-bottom:1px solid #454d5b;display:flex;align-items:center;justify-content:space-between;padding:0 12px;color:#f3f5f9}.player header button{background:none;border:0;color:#e4e8ef;font-size:28px;cursor:pointer}.wave-wrap{height:88px;position:relative;cursor:crosshair;border-radius:4px;overflow:hidden}.wave-wrap canvas{width:100%;height:100%}.selection{position:absolute;top:0;bottom:0;border-left:3px solid #ff8a22;border-right:3px solid #ff8a22;background:#ff8a2233;pointer-events:none}.times{display:flex;justify-content:space-between;color:#a9c8f4;font-size:12px}.seek{width:100%;accent-color:#ff8a22}.controls{display:flex;justify-content:center;align-items:center;gap:14px;margin:11px 0}.controls button{border:0;background:none;color:#d8dde7;font-size:20px;cursor:pointer}.controls .play{font-size:27px}.controls label{position:absolute;left:28px;font-size:11px;color:#b8c1ce}.controls select{background:#252a33;color:#e4e8f1;border:1px solid #697486;border-radius:5px;padding:3px}.trim{border-top:1px solid #3d4654;padding-top:9px}.trim label{display:block;color:#c5cbd6;font-size:11px}.trim em{font-style:normal;color:#ff9a42}.trim input{width:100%;accent-color:#ff8a22}.cut{width:100%;border:0;border-radius:6px;background:#ff8a22;color:#16191e;padding:9px;font-weight:700;cursor:pointer}.preview,.saved{margin-top:12px;border:1px solid #3e4a5a;border-radius:8px;padding:10px}.preview{display:flex;align-items:center;gap:8px}.preview span,.saved small{font-size:11px;color:#ff9a42;white-space:nowrap}.preview audio{width:100%}.preview button,.saved button{border:1px solid #546175;background:#292f39;color:#dce3ed;border-radius:5px;padding:5px 8px;cursor:pointer}.saved button{margin:8px 6px 0 0}.saved button.selected{border-color:#ff8a22;color:#ffaf68}
.wave-wrap{touch-action:none}.handle{position:absolute;top:0;bottom:0;width:10px;background:#ff8a22}.handle.left{left:-5px}.handle.right{right:-5px}.playhead{position:absolute;top:0;bottom:0;width:2px;background:#e8d8ff;box-shadow:0 0 6px #e8d8ff;pointer-events:none}.controls{position:relative}.controls .scissors{position:absolute;right:0;font-size:25px}.controls button:disabled{opacity:.5}.controls label{left:0}.controls .play{font-size:27px}
</style>
