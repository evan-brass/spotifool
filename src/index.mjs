import { inout } from "./auth.mjs";
import './fancy-player.mjs';

// Render the page:
document.body.innerHTML = `
	<header>
		<fancy-player></fancy-player>
	</header>
	<main>

	</main>
`;
document.querySelector('header').insertAdjacentElement('afterbegin', inout);
