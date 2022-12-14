import dayjs from "dayjs";
import { createWriteStream } from "fs";
import fs from "fs/promises";
import got from "got";
import path from "path";
import {
  AppState,
  chunkArray,
  makeFolderIfNotExists,
  MAX_PARALLELL_PROCESSING_AMOUNT,
  memoriesFolder,
  Memory,
  updateFileMetadata,
} from "./utils";

import ffmpeg from "fluent-ffmpeg";
import { getDateFromVideoName, getVideoDuration, removeFile } from "./utils";

/**
 * Download snap memories to disk
 * @param memories JSON object of memories to download
 * @param state App state
 */
export async function downloadMemories(memories: Memory[], state: AppState) {
  for (const memory of memories) {
    ++state.currently;

    const downloadLink = memory["Download Link"];
    const fileType = memory["Media Type"] === "Image" ? ".png" : ".mp4";
    const date = memory["Date"];

    // keep user updated on what's happening
    state.spinner.text = `Downloading ${
      fileType == ".png" ? "images" : "videos"
    } ${state.currently}/${memories.length}`;

    try {
      const S3Url = await (
        await fetch(downloadLink, {
          method: "POST",
        })
      ).text();

      // create year folder
      const yearFolder = path.join(
        memoriesFolder,
        dayjs(date).year().toString()
      );
      makeFolderIfNotExists(yearFolder);

      // eg. ../memories/year/filename.png or ../memories/year/video.mp4
      const memoryFilePath = path.join(yearFolder, date.concat(fileType));

      await downloadMemoryToDisk({
        memory,
        S3Url,
        memoryFilePath,
        date,
      });
    } catch (err) {
      console.log(err);
    }
  }
}

async function downloadMemoryToDisk({
  memoryFilePath,
  memory,
  date,
  S3Url,
}: {
  memoryFilePath: string;
  memory: Memory;
  date: string; // date of recording
  S3Url: string; // download link,
}): Promise<void> {
  return new Promise((res, rej) => {
    const downloadStream = got.stream(S3Url);
    const fileWriterStream = createWriteStream(memoryFilePath);

    downloadStream.on("error", (error) => {
      console.error(`Download failed: ${error.message}`);

      // log errors to file
      fs.writeFile("errors.txt", `\r\n${JSON.stringify(memory)}`, {
        flag: "a+",
      });

      rej();
    });

    fileWriterStream
      .on("error", (error) => {
        console.error(`Could not write file to system: ${error.message}`);
      })
      .on("finish", async () => {
        // Update created at time so it's synced properly in finder
        await updateFileMetadata(memoryFilePath, date);

        res();
      });

    downloadStream.pipe(fileWriterStream);
  });
}

/**
 * Generate list of video clips that have to be merged together to a single video file
 * @returns 2D array of video path names to merge
 */
export async function findVideoMemoriesToMerge(): Promise<string[][]> {
  const videosToMerge: string[][] = [];
  const dateSnapsMergeByDefault = dayjs("2021-09-01");

  // get all folders (years) in memories
  const folders = (await fs.readdir(memoriesFolder)).filter(
    (folder) => folder.charAt(0) !== "."
  );

  for (const folder of folders.reverse()) {
    if (dayjs(folder).isAfter(dateSnapsMergeByDefault)) {
      continue;
    }

    // get all files within those folders
    const folderPath = path.join(memoriesFolder, folder);
    const files = await fs.readdir(folderPath);

    let clips: string[] = [];

    // loop over each file and check whether it should be a clip
    for (const file of files) {
      const curr = getDateFromVideoName(file);
      const duration = getVideoDuration(folder, file);
      const isLastFile = files.at(-1) === file;
      const isWithinTenSecOfPrev =
        dayjs(curr).diff(clips.at(-1), "seconds") <= 10 && duration <= 10;

      // if snap is after date snaps merge by default, skip
      const isAfterSeptember2021 = dayjs(curr).isAfter(dateSnapsMergeByDefault);
      if (isAfterSeptember2021) continue;

      if (isWithinTenSecOfPrev && !isLastFile) {
        clips.push(curr);
      } else {
        if (isLastFile) clips.push(curr);

        if (clips.length !== 1 && clips.length !== 0) {
          // console.log("Should merge", folder, clips);
          videosToMerge.push([folder, ...clips]);
        }

        // reset state and push current
        clips = [];
        clips.push(curr);
      }
    }
  }

  return videosToMerge;
}

/**
 * Process videos to merge in chunks
 * @param state App state
 */
export async function mergeVideoClips(state: AppState) {
  state.spinner.text = "Finding video memories to merge...";
  const clipsToMerge = await findVideoMemoriesToMerge();
  state.spinner.text = `Found ${clipsToMerge.length} videos with unlinked clips`;

  const chunkedClipsToMerge = chunkArray(
    clipsToMerge,
    MAX_PARALLELL_PROCESSING_AMOUNT
  );

  for (const chunk of chunkedClipsToMerge) {
    await Promise.all(
      chunk.map(async ([year, ...paths]) => {
        try {
          state.spinner.color = "green";
          state.spinner.text = `Merging video clips (${
            chunkedClipsToMerge.indexOf(chunk) + 1
          }/${chunkedClipsToMerge.length})`;

          await generateSingleVideo(paths, year);
        } catch (err) {
          console.log("Error", err);
        }
      })
    );
  }
}

/**
 * Use FFMPEG to generate a single video clip from multiple clips
 * @param clips Array of clips to merge
 * @param folder Year of which clips were recorded
 * @returns Void
 */
async function generateSingleVideo(clips: string[], folder): Promise<void> {
  const command = ffmpeg();

  // push location on filesystem for all clips to ffmpeg
  for (const clip of clips) {
    command.input(path.join(memoriesFolder, folder, `${clip} UTC.mp4`));
  }

  const mergedFileName = `${clips[0]} UTC clip.mp4`;
  const mergedFilePath = path.join(memoriesFolder, folder, mergedFileName);

  // merge video files
  return new Promise((res, rej) => {
    command
      // .on("progress", (progress) =>
      //   console.info(
      //     `✨ Processing.. ${Math.floor(progress.percent / clips.length)}% done`
      //   )
      // )
      .on("error", async (err) => {
        console.log(`😱 Error ${err.message}`);
        await removeFile(mergedFilePath);

        rej();
      })
      .on("end", async () => {
        console.log(`✅ Merged ${clips.join(", ")} to ${mergedFileName}`);

        // update metadata fields so video is synced properly in finder
        await updateFileMetadata(
          mergedFilePath,
          getDateFromVideoName(clips[0])
        );

        // remove original video files if successful
        for (const clip of clips) {
          const clipPath = path.join(
            memoriesFolder,
            folder,
            clip.concat(" UTC.mp4")
          );
          await removeFile(clipPath);
        }

        res();
      })
      .fps(30)
      .outputOption("-update 1")
      .mergeToFile(mergedFilePath);
  });
}
