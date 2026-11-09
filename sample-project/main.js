import { greet } from "./utils.js";

document.querySelector("body").dataset.message = greet("Impact Viz");
fetch("/api/demo");
