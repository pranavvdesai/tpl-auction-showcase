// Browser-side photo preparation: the whole photo, never cropped, scaled down to a small WebP.

export const PHOTO_MAX_SIDE = 1200

export async function preparePhoto(source: Blob, maxSide = PHOTO_MAX_SIDE): Promise<Blob> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('This browser cannot read the photo (HEIC or damaged file).')
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available in this browser.')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
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
