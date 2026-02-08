# gametest

A simple game level design system that allows you to create, load, and manage game levels.

## Features

- **Level Design System**: Create and manage game levels with entities
- **Entity Types**: Support for Players, Enemies, and Platforms
- **JSON-based Level Files**: Easy-to-edit level definitions
- **Game Engine**: Simple engine for loading and managing levels
- **ASCII Rendering**: Visual representation of levels in the terminal

## Installation

No external dependencies required! This project uses only Python standard library.

```bash
git clone https://github.com/chrandalf/gametest.git
cd gametest
```

## Quick Start

Run the demo to see the level design system in action:

```bash
python3 demo.py
```

This will:
1. Create a custom level programmatically
2. Load existing levels from files
3. Display ASCII representations of levels
4. Demonstrate level editing

## Usage

### Creating a Level Programmatically

```python
from level import Level, Player, Enemy, Platform

# Create a new level
level = Level("My First Level", width=800, height=600)

# Add entities
level.add_entity(Player(100, 500))
level.add_entity(Platform(0, 550, 800, 50))
level.add_entity(Enemy(600, 500, 'basic'))

# Save to file
level.save('levels/my_level.json')
```

### Loading a Level from File

```python
from level import Level

# Load level
level = Level.load('levels/level1.json')

# Access level properties
print(f"Level: {level.name}")
print(f"Dimensions: {level.width}x{level.height}")
print(f"Entities: {len(level.entities)}")
```

### Using the Game Engine

```python
from game_engine import GameEngine

# Create engine and load level
engine = GameEngine()
engine.load_level('levels/level1.json')

# Get level information
info = engine.get_level_info()
print(info)

# Render ASCII representation
print(engine.render_ascii())
```

## Level File Format

Levels are stored as JSON files with the following structure:

```json
{
  "name": "Level Name",
  "width": 800,
  "height": 600,
  "metadata": {
    "difficulty": "easy",
    "description": "Level description"
  },
  "entities": [
    {
      "type": "player",
      "x": 100,
      "y": 500
    },
    {
      "type": "platform",
      "x": 0,
      "y": 550,
      "width": 800,
      "height": 50
    },
    {
      "type": "enemy",
      "x": 600,
      "y": 500,
      "enemy_type": "basic"
    }
  ]
}
```

## Entity Types

### Player
- Position: `x`, `y`
- Type: `player`

### Enemy
- Position: `x`, `y`
- Type: `enemy`
- Additional: `enemy_type` (e.g., "basic", "fast", "boss")

### Platform
- Position: `x`, `y`
- Type: `platform`
- Dimensions: `width`, `height`

## Running Tests

```bash
python3 -m unittest test_level.py
```

Or run tests with verbose output:

```bash
python3 -m unittest test_level.py -v
```

## Project Structure

```
gametest/
├── README.md           # This file
├── level.py           # Level and entity classes
├── game_engine.py     # Game engine for managing levels
├── demo.py            # Demo script
├── test_level.py      # Unit tests
└── levels/            # Level files directory
    ├── level1.json    # Tutorial level
    ├── level2.json    # Challenge level
    └── ...
```

## License

MIT License