import request from '@/utils/request'
export const freeCreateAPI = {
  list(params) { return request.get('/free/creations', { params: params || {} }) },
  text(data) { return request.post('/free/text', data) },
  audio(data) { return request.post('/free/audio', data) },
  voices() { return request.get('/free/voices') },
  uploadVoice(file) { const form = new FormData(); form.append('file', file); return request.post('/free/voice-reference', form, { headers: { 'Content-Type': 'multipart/form-data' } }) },
  trimVoice(data) { return request.post('/free/voice-reference/trim', data) },
}
