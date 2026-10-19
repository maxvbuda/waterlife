# Waterlife

A browser game where you play as an octopus and explore the ocean, from a sunny coral reef down to the pitch-black abyss. You learn about real marine life as you go.

## Play

Open `index.html` in any modern browser. There's no build step and nothing to install.

To host it, enable **GitHub Pages** for this repo (Settings → Pages → deploy from `main`, root folder). The game will then be live at `https://<user>.github.io/waterlife/`.

## How to play

- **Swim:** WASD or the arrow keys, or hold the mouse or a finger where you want to go
- **Jet boost:** Shift, or point far away
- **Study a creature:** E, or tap the Study bubble
- **Squirt ink:** Space. This confuses sharks.
- **Camouflage:** C. Sharks can't see you, but you swim slowly.
- **Field Journal:** J
- **Sound:** M

Find and study all 18 species across the **Sunlit**, **Twilight** and **Midnight** zones to fill your Field Journal. Each creature has a fact card. Every 3 species you study unlock a quiz worth bonus pearls. Eat shrimp to heal, rest in your den, and watch out for sharks.

## Species

| Sunlit Zone | Twilight Zone | Midnight Zone |
| --- | --- | --- |
| Clownfish | Lanternfish | Sperm Whale |
| Seahorse | Marine Hatchetfish | Vampire Squid |
| Sea Star | Swordfish | Deep-Sea Anglerfish |
| Parrotfish | Giant Squid | Gulper Eel |
| Hermit Crab | | Dumbo Octopus |
| Green Sea Turtle | | Giant Isopod |
| Moon Jellyfish | | |
| Bottlenose Dolphin | | |

## Project layout

- `index.html`: page structure, HUD and modal containers
- `style.css`: HUD, cards, quiz and journal styling
- `js/creatures.js`: species data (facts, quizzes, habitats) and the procedural art for every creature
- `js/game.js`: world, physics, AI, rendering and UI logic

All art is drawn with the Canvas 2D API. There are no image assets.
