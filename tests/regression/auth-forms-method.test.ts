import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The sign-in and sign-up forms are client components. Until React hydrates,
// pressing the submit button is a native form submit, and a <form> without a
// method sends a GET: the email and password end up in the URL, the browser
// history and the server logs. method="post" keeps them in the request body.
// Once hydrated, onSubmit calls preventDefault and the form works as before.
const CREDENTIAL_FORM_PAGES = [
	"src/app/(auth)/sign-in/[[...sign-in]]/page.tsx",
	"src/app/(auth)/sign-up/[[...sign-up]]/page.tsx",
];

describe("credential forms submit with POST", () => {
	for (const file of CREDENTIAL_FORM_PAGES) {
		it(`${file} never falls back to a GET submit`, () => {
			const source = readFileSync(file, "utf8");
			// `=>` may appear inside a JSX attribute value, so it must not end the tag.
			const formTags = source.match(/<form\b(?:[^>]|=>)*>/g) ?? [];
			assert.ok(formTags.length > 0, "expected at least one <form> element");
			for (const tag of formTags) {
				assert.match(
					tag,
					/\bmethod="post"/i,
					`form without method="post" would send credentials in the URL: ${tag}`,
				);
			}
		});
	}
});
