#!/usr/bin/env python3
"""
Demo script showing level design system in action.
This script demonstrates how to:
1. Create levels programmatically
2. Load levels from files
3. Save levels to files
4. Use the game engine to manage levels
"""

from level import Level, Player, Enemy, Platform
from game_engine import GameEngine


def create_custom_level():
    """Create a custom level programmatically."""
    print("=== Creating Custom Level ===\n")
    
    # Create a new level
    level = Level("Custom Level - Boss Fight", width=1200, height=900)
    level.metadata = {
        'difficulty': 'hard',
        'description': 'Epic boss battle arena',
        'has_boss': True
    }
    
    # Add player spawn
    level.add_entity(Player(100, 800))
    
    # Add ground
    level.add_entity(Platform(0, 850, 1200, 50))
    
    # Add floating platforms
    level.add_entity(Platform(300, 700, 200, 20))
    level.add_entity(Platform(700, 600, 200, 20))
    level.add_entity(Platform(500, 500, 200, 20))
    
    # Add enemies
    level.add_entity(Enemy(400, 680, 'basic'))
    level.add_entity(Enemy(800, 580, 'fast'))
    level.add_entity(Enemy(600, 480, 'boss'))
    
    # Save the level
    level.save('levels/level3.json')
    print(f"Created and saved level: {level.name}")
    print(f"Level dimensions: {level.width}x{level.height}")
    print(f"Total entities: {len(level.entities)}\n")
    
    return level


def demo_level_loading():
    """Demonstrate loading levels from files."""
    print("=== Loading Levels from Files ===\n")
    
    engine = GameEngine()
    
    # Load and display Level 1
    print("Loading Level 1...")
    engine.load_level('levels/level1.json')
    info = engine.get_level_info()
    print(f"Level: {info['name']}")
    print(f"Dimensions: {info['width']}x{info['height']}")
    print(f"Entities: {info['entity_count']}")
    print(f"  - Players: {info['entities']['players']}")
    print(f"  - Enemies: {info['entities']['enemies']}")
    print(f"  - Platforms: {info['entities']['platforms']}")
    print("\nASCII Representation:")
    print(engine.render_ascii())
    
    # Load and display Level 2
    print("\n" + "="*50 + "\n")
    print("Loading Level 2...")
    engine.load_level('levels/level2.json')
    info = engine.get_level_info()
    print(f"Level: {info['name']}")
    print(f"Dimensions: {info['width']}x{info['height']}")
    print(f"Entities: {info['entity_count']}")
    print(f"  - Players: {info['entities']['players']}")
    print(f"  - Enemies: {info['entities']['enemies']}")
    print(f"  - Platforms: {info['entities']['platforms']}")
    print("\nASCII Representation:")
    print(engine.render_ascii())


def demo_level_editor():
    """Demonstrate editing an existing level."""
    print("\n" + "="*50 + "\n")
    print("=== Editing a Level ===\n")
    
    # Load level
    level = Level.load('levels/level1.json')
    print(f"Loaded: {level.name}")
    print(f"Initial entity count: {len(level.entities)}")
    
    # Add more entities
    level.add_entity(Platform(600, 300, 150, 20))
    level.add_entity(Enemy(650, 280, 'fast'))
    
    print(f"After editing: {len(level.entities)} entities")
    
    # Save as a new level
    level.name = "Level 1 - Modified"
    level.save('levels/level1_modified.json')
    print(f"Saved modified level to: levels/level1_modified.json\n")


def main():
    """Main demo function."""
    print("╔" + "═"*48 + "╗")
    print("║  Game Level Design System - Demo              ║")
    print("╚" + "═"*48 + "╝\n")
    
    # Demo 1: Create custom level
    create_custom_level()
    
    # Demo 2: Load levels
    demo_level_loading()
    
    # Demo 3: Edit level
    demo_level_editor()
    
    print("\n" + "="*50)
    print("Demo complete! Check the 'levels' directory for level files.")
    print("="*50)


if __name__ == '__main__':
    main()
