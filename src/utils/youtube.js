export const getYoutubeVideoId = (url = "") => {
  const patterns = [
    /youtube\.com\/watch\?v=([^&?/]+)/,
    /youtube\.com\/shorts\/([^&?/]+)/,
    /youtube\.com\/embed\/([^&?/]+)/,
    /youtu\.be\/([^&?/]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return "";
};

export const getYoutubeThumbnail = (url = "") => {
  const videoId = getYoutubeVideoId(url);
  return videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : "";
};

export const getYoutubeEmbedUrl = (url = "") => {
  const videoId = getYoutubeVideoId(url);
  return videoId ? `https://www.youtube.com/embed/${videoId}` : "";
};
