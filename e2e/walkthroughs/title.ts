// An example walkthrough: the title screen, then the first seconds of a night. Run it against a local build with
// `bun run walkthrough -- e2e/walkthroughs/title.ts --out /tmp/title-walkthrough`, and copy it as a starting point for
// a pull request's walkthrough (keep pull-request scripts outside the repo; only the tool and this example live here).
import type { Walkthrough } from "../walkthrough";

const walkthrough: Walkthrough = {
  url: "http://localhost:3000/",
  segments: [
    {
      id: "title",
      caption: "The title screen: the logo, the setting, the warden and Light the lamps.",
      waitFor: "canvas",
      seconds: 3,
    },
    {
      id: "night",
      caption: "Lighting the lamps starts the night; the warden walks to the right.",
      setup: async (page) => {
        await page.getByRole("button", { name: "Light the lamps" }).click();
      },
      actions: [
        { at: 0.5, run: (page) => page.keyboard.down("ArrowRight") },
        { at: 2.5, run: (page) => page.keyboard.up("ArrowRight") },
      ],
      seconds: 4,
    },
  ],
};

export default walkthrough;
