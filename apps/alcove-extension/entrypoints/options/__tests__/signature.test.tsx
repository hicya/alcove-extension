import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OptionsPage } from "../OptionsPage";

describe("options page signature", () => {
  it("fills the hicya wordmark with the every-color splotch field, as real text", () => {
    const html = renderToStaticMarkup(<OptionsPage />);

    expect(html).toMatch(
      /<p class="wordmark"><span class="[^"]*" style="--splotch-text-fill:[^"]*data:image\/svg\+xml[^"]*">hicya<\/span><\/p>/,
    );
    // The signature is the only splotch on the page.
    expect(html.match(/--splotch-text-fill/g)).toHaveLength(1);
  });
});
