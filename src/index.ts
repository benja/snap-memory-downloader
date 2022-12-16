import dayjs from "dayjs";
import ora from "ora";
import json from "../memories_history.json" assert { type: "json" };
import { downloadMemories, mergeVideoClips } from "./services";
import {
  AppState,
  makeFolderIfNotExists,
  memoriesFolder,
  Memory,
} from "./utils";

const imageMemories = json["Saved Media"].filter(
  (memory) => memory["Media Type"] === "Image"
) as Memory[];

const videoMemories = json["Saved Media"].filter(
  (memory) => memory["Media Type"] === "Video"
) as Memory[];

// cool spinner thing
const spinner = ora({
  color: "gray",
  text: "Starting download...",
});

spinner.start();

// create folder which we will store memories in
await makeFolderIfNotExists(memoriesFolder);

// app state to be shared between fns
const state: AppState = {
  spinner,
  currently: 0,
};

// download images first
state.spinner.color = "yellow";
await downloadMemories(imageMemories, state);

// then videos
state.currently = 0;
state.spinner.color = "magenta";
await downloadMemories(videoMemories, state);

// then merge clips from before september 2021
await mergeVideoClips(state);

state.spinner.succeed();
