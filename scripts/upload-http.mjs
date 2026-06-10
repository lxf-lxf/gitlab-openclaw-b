import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './lib/common.mjs'

function findLatestArchive(dir) {
  if (!fs.existsSync(dir)) return null
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith('gitlab-b-center-') && (f.endsWith('.tar.gz') || f.endsWith('.zip')))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  return files[0]?.name || null
}

async function uploadFile(filePath, uploadUrl, token) {
  const fileName = path.basename(filePath)
  const fileBuffer = fs.readFileSync(filePath)
  const targetUrl = uploadUrl.endsWith('/')
    ? `${uploadUrl}${fileName}`
    : uploadUrl

  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`

  let res = await fetch(targetUrl, {
    method: 'PUT',
    headers: {
      ...headers,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(fileBuffer.length)
    },
    body: fileBuffer
  })

  if (res.ok) {
    return { method: 'PUT', url: targetUrl, status: res.status }
  }

  const field = process.env.UPLOAD_FIELD || 'file'
  const form = new FormData()
  form.append(field, new Blob([fileBuffer]), fileName)

  res = await fetch(uploadUrl, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Upload failed (${res.status}): ${text || res.statusText}`)
  }

  return { method: 'POST', url: uploadUrl, status: res.status }
}

export default async function httpUpload(args = []) {
  const uploadUrl = process.env.UPLOAD_URL
  if (!uploadUrl) {
    throw new Error('UPLOAD_URL is required for --http mode')
  }

  let archivePath = args[0]
  if (!archivePath) {
    const latest = findLatestArchive(path.join(ROOT, 'release'))
    if (!latest) {
      throw new Error('No archive in release/. Run npm run pack first.')
    }
    archivePath = path.join(ROOT, 'release', latest)
  } else if (!path.isAbsolute(archivePath)) {
    archivePath = path.join(ROOT, archivePath)
  }

  if (!fs.existsSync(archivePath)) {
    throw new Error(`Archive not found: ${archivePath}`)
  }

  const token = process.env.UPLOAD_TOKEN || ''
  const sizeMb = (fs.statSync(archivePath).size / 1024 / 1024).toFixed(2)

  console.log(`\n📤 HTTP uploading ${path.basename(archivePath)} (${sizeMb} MB)...`)
  console.log(`   → ${uploadUrl}\n`)

  const result = await uploadFile(archivePath, uploadUrl, token)
  console.log(`✅ Upload success via ${result.method} (HTTP ${result.status})`)
  console.log(`   ${result.url}\n`)
}
