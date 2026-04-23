import { config } from '../config.ts';

const base = config.publicBaseUrl.replace(/\/$/, '');

export const fileLinks = (fileId: string, currentVersionId: string | null) => ({
  self: `${base}/v1/files/${fileId}`,
  versions: `${base}/v1/files/${fileId}/versions`,
  shares: `${base}/v1/files/${fileId}/shares`,
  currentContent: currentVersionId
    ? `${base}/v1/files/${fileId}/versions/${currentVersionId}/content`
    : undefined,
});

export const versionLinks = (fileId: string, versionId: string) => ({
  self: `${base}/v1/files/${fileId}/versions/${versionId}`,
  file: `${base}/v1/files/${fileId}`,
  content: `${base}/v1/files/${fileId}/versions/${versionId}/content`,
});

export const shareUrl = (token: string) => `${base}/v1/shares/${token}`;
export const shareContentUrl = (token: string) => `${base}/v1/shares/${token}/content`;

export const fileUrl = (fileId: string) => `${base}/v1/files/${fileId}`;
export const versionUrl = (fileId: string, versionId: string) =>
  `${base}/v1/files/${fileId}/versions/${versionId}`;
export const shareResourceUrl = (fileId: string, shareId: string) =>
  `${base}/v1/files/${fileId}/shares/${shareId}`;
