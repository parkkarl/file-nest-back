import type { File, Share, Version } from '../db/schema.ts';
import { fileLinks, shareContentUrl, shareUrl, versionLinks } from './hateoas.ts';

export function toFileDto(
  file: File,
  extras: { mimeType: string; sizeBytes: number; versionCount: number },
) {
  return {
    id: file.id,
    name: file.name,
    description: file.description,
    mimeType: extras.mimeType,
    sizeBytes: extras.sizeBytes,
    currentVersionId: file.currentVersionId,
    versionCount: extras.versionCount,
    ownerId: file.ownerId,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    _links: fileLinks(file.id, file.currentVersionId),
  };
}

export function toVersionDto(v: Version) {
  return {
    id: v.id,
    fileId: v.fileId,
    versionNumber: v.versionNumber,
    note: v.note,
    mimeType: v.mimeType,
    sizeBytes: v.sizeBytes,
    checksum: v.checksum,
    createdAt: v.createdAt,
    createdBy: v.createdBy,
    _links: versionLinks(v.fileId, v.id),
  };
}

export function toShareDto(s: Share) {
  return {
    id: s.id,
    fileId: s.fileId,
    versionId: s.versionId,
    token: s.token,
    url: shareUrl(s.token),
    hasPassword: !!s.passwordHash,
    expiresAt: s.expiresAt,
    maxDownloads: s.maxDownloads,
    downloadCount: s.downloadCount,
    createdAt: s.createdAt,
    revokedAt: s.revokedAt,
  };
}

export function toPublicShareDto(s: Share, v: Version, file: File) {
  return {
    fileName: file.name,
    sizeBytes: v.sizeBytes,
    mimeType: v.mimeType,
    versionNumber: v.versionNumber,
    expiresAt: s.expiresAt,
    _links: { content: shareContentUrl(s.token) },
  };
}
