import { render } from "preact";
import { Counter } from "./components/Counter";

const root = document.getElementById("root");
if (root) {
  render(<Counter />, root);
}
