// Deliberately invalid browser entry. verify.mjs asserts that the build rejects it.
import { createTogglyRequest } from '@ops-ai/solid-feature-flags-toggly/server';
console.log(createTogglyRequest);
