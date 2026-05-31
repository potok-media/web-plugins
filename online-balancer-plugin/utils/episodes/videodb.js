import { parsePlayerJSFile } from '../parser.js';
import { PotokSDK } from 'potok-sdk';

export async function fetchVideoDBEpisodes(mediaId, checkWatched) {
  const parsedFiles = [];
  const apiKey = await PotokSDK.storage.local.getItem("videodb_key") || "";
  const url = `https://videodb.cloud/embed/splayer.php?type=serial&id=${mediaId}${apiKey ? `&key=${apiKey}` : ""}`;
  
  const response = await PotokSDK.http.get(`/api/proxy?url=${encodeURIComponent(url)}`, {
    "Referer": "https://videodb.cloud/"
  });
  if (response.status === 200) {
    const html = response.data;
    const fileIndex = html.search(/"file"\s*:/i);
    if (fileIndex !== -1) {
      const textFromFile = html.substring(fileIndex);
      const bracketStart = textFromFile.indexOf("[");
      if (bracketStart !== -1) {
        let balance = 0, jsonStr = "";
        for (let i = bracketStart; i < textFromFile.length; i++) {
          const char = textFromFile[i];
          if (char === "[") balance++;
          else if (char === "]") balance--;
          jsonStr += char;
          if (balance === 0) break;
        }
        const cleanJSON = jsonStr.replace(/,\s*([}\]])/g, "$1");
        const balSeasons = JSON.parse(cleanJSON);

        const extractNum = (str) => {
          const m = str.match(/([0-9]+)/);
          return m ? parseInt(m[1], 10) : 1;
        };

        let fileIndexSeq = 0;
        balSeasons.forEach((seasonObj) => {
          const sNum = extractNum(seasonObj.title);
          if (seasonObj.folder) {
            seasonObj.folder.forEach((epObj) => {
              const epNum = extractNum(epObj.title);
              
              // Parse playlist for voices
              const parsedData = parsePlayerJSFile(epObj.file);
              const audios = parsedData ? Object.keys(parsedData).map(voice => ({
                id: voice,
                name: voice,
                url: parsedData[voice][0]?.url || ""
              })) : [];

              parsedFiles.push({
                id: `videodb:${sNum}:${epNum}`,
                title: epObj.title,
                season: sNum,
                episode: epNum,
                index: fileIndexSeq++,
                url: epObj.file,
                provider: "videodb",
                audios,
                isWatched: checkWatched(sNum, epNum),
                headers: { "Referer": "https://videodb.cloud/" }
              });
            });
          }
        });
      }
    }
  }
  return parsedFiles;
}
