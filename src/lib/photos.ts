// Browser-side photo preparation: square crop biased towards the face, small WebP.

export const PHOTO_SIZE = 640

export async function toSquarePhoto(source: Blob, size = PHOTO_SIZE): Promise<Blob> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('This browser cannot read the photo (HEIC or damaged file).')
  }
  const side = Math.min(bitmap.width, bitmap.height)
  const sx = (bitmap.width - side) / 2
  const sy = (bitmap.height - side) * 0.3
  const out = Math.min(size, side)
  const canvas = document.createElement('canvas')
  canvas.width = out
  canvas.height = out
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available in this browser.')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out)
  bitmap.close()

  const encode = (type: string, quality: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
  const webp = await encode('image/webp', 0.85)
  if (webp && webp.type === 'image/webp') return webp
  const jpeg = await encode('image/jpeg', 0.88)
  if (!jpeg) throw new Error('Could not convert the photo.')
  return jpeg
}

export function photoPath(rollNo: string, blob: Blob): string {
  const safe = rollNo.toUpperCase().replace(/[^A-Z0-9_-]/g, '_')
  return `${safe}.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`
}
