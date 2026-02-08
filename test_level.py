"""
Tests for the level design system.
"""

import unittest
import json
import os
import tempfile
from level import Level, Player, Enemy, Platform, Entity
from game_engine import GameEngine


class TestEntity(unittest.TestCase):
    """Test Entity class."""
    
    def test_entity_creation(self):
        """Test creating a basic entity."""
        entity = Entity(10, 20, 'test')
        self.assertEqual(entity.x, 10)
        self.assertEqual(entity.y, 20)
        self.assertEqual(entity.entity_type, 'test')
    
    def test_entity_to_dict(self):
        """Test entity serialization."""
        entity = Entity(10, 20, 'test')
        data = entity.to_dict()
        self.assertEqual(data['x'], 10)
        self.assertEqual(data['y'], 20)
        self.assertEqual(data['type'], 'test')
    
    def test_entity_from_dict(self):
        """Test entity deserialization."""
        data = {'x': 30, 'y': 40, 'type': 'test'}
        entity = Entity.from_dict(data)
        self.assertEqual(entity.x, 30)
        self.assertEqual(entity.y, 40)
        self.assertEqual(entity.entity_type, 'test')


class TestPlayer(unittest.TestCase):
    """Test Player class."""
    
    def test_player_creation(self):
        """Test creating a player."""
        player = Player(50, 60)
        self.assertEqual(player.x, 50)
        self.assertEqual(player.y, 60)
        self.assertEqual(player.entity_type, 'player')


class TestEnemy(unittest.TestCase):
    """Test Enemy class."""
    
    def test_enemy_creation(self):
        """Test creating an enemy."""
        enemy = Enemy(70, 80, 'fast')
        self.assertEqual(enemy.x, 70)
        self.assertEqual(enemy.y, 80)
        self.assertEqual(enemy.entity_type, 'enemy')
        self.assertEqual(enemy.enemy_type, 'fast')
    
    def test_enemy_serialization(self):
        """Test enemy serialization with enemy_type."""
        enemy = Enemy(70, 80, 'boss')
        data = enemy.to_dict()
        self.assertEqual(data['enemy_type'], 'boss')
        
        enemy2 = Enemy.from_dict(data)
        self.assertEqual(enemy2.enemy_type, 'boss')


class TestPlatform(unittest.TestCase):
    """Test Platform class."""
    
    def test_platform_creation(self):
        """Test creating a platform."""
        platform = Platform(100, 200, 300, 50)
        self.assertEqual(platform.x, 100)
        self.assertEqual(platform.y, 200)
        self.assertEqual(platform.width, 300)
        self.assertEqual(platform.height, 50)
        self.assertEqual(platform.entity_type, 'platform')
    
    def test_platform_serialization(self):
        """Test platform serialization."""
        platform = Platform(100, 200, 300, 50)
        data = platform.to_dict()
        self.assertEqual(data['width'], 300)
        self.assertEqual(data['height'], 50)
        
        platform2 = Platform.from_dict(data)
        self.assertEqual(platform2.width, 300)
        self.assertEqual(platform2.height, 50)


class TestLevel(unittest.TestCase):
    """Test Level class."""
    
    def test_level_creation(self):
        """Test creating a level."""
        level = Level("Test Level", 800, 600)
        self.assertEqual(level.name, "Test Level")
        self.assertEqual(level.width, 800)
        self.assertEqual(level.height, 600)
        self.assertEqual(len(level.entities), 0)
    
    def test_add_entity(self):
        """Test adding entities to a level."""
        level = Level("Test Level")
        player = Player(10, 20)
        enemy = Enemy(30, 40)
        
        level.add_entity(player)
        level.add_entity(enemy)
        
        self.assertEqual(len(level.entities), 2)
    
    def test_get_entities_by_type(self):
        """Test filtering entities by type."""
        level = Level("Test Level")
        level.add_entity(Player(10, 20))
        level.add_entity(Enemy(30, 40))
        level.add_entity(Enemy(50, 60))
        level.add_entity(Platform(0, 100, 200, 20))
        
        players = level.get_entities_by_type('player')
        enemies = level.get_entities_by_type('enemy')
        platforms = level.get_entities_by_type('platform')
        
        self.assertEqual(len(players), 1)
        self.assertEqual(len(enemies), 2)
        self.assertEqual(len(platforms), 1)
    
    def test_level_serialization(self):
        """Test level to_dict and from_dict."""
        level = Level("Test Level", 800, 600)
        level.metadata = {'difficulty': 'easy'}
        level.add_entity(Player(10, 20))
        level.add_entity(Enemy(30, 40, 'fast'))
        level.add_entity(Platform(0, 100, 200, 20))
        
        data = level.to_dict()
        
        self.assertEqual(data['name'], "Test Level")
        self.assertEqual(data['width'], 800)
        self.assertEqual(data['height'], 600)
        self.assertEqual(len(data['entities']), 3)
        
        # Test deserialization
        level2 = Level.from_dict(data)
        self.assertEqual(level2.name, "Test Level")
        self.assertEqual(level2.width, 800)
        self.assertEqual(len(level2.entities), 3)
        self.assertEqual(level2.metadata['difficulty'], 'easy')
    
    def test_level_save_and_load(self):
        """Test saving and loading levels from files."""
        # Create a temporary file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            temp_path = f.name
        
        try:
            # Create and save level
            level = Level("Test Level", 800, 600)
            level.add_entity(Player(10, 20))
            level.add_entity(Enemy(30, 40))
            level.save(temp_path)
            
            # Load level
            loaded_level = Level.load(temp_path)
            
            self.assertEqual(loaded_level.name, "Test Level")
            self.assertEqual(loaded_level.width, 800)
            self.assertEqual(len(loaded_level.entities), 2)
        finally:
            # Clean up
            if os.path.exists(temp_path):
                os.remove(temp_path)


class TestGameEngine(unittest.TestCase):
    """Test GameEngine class."""
    
    def test_engine_creation(self):
        """Test creating a game engine."""
        engine = GameEngine()
        self.assertIsNone(engine.current_level)
        self.assertFalse(engine.running)
    
    def test_load_level_object(self):
        """Test loading a level object."""
        engine = GameEngine()
        level = Level("Test Level")
        level.add_entity(Player(10, 20))
        
        engine.load_level_object(level)
        
        self.assertIsNotNone(engine.current_level)
        self.assertEqual(engine.current_level.name, "Test Level")
    
    def test_get_level_info(self):
        """Test getting level information."""
        engine = GameEngine()
        level = Level("Test Level", 800, 600)
        level.add_entity(Player(10, 20))
        level.add_entity(Enemy(30, 40))
        level.add_entity(Enemy(50, 60))
        level.add_entity(Platform(0, 100, 200, 20))
        
        engine.load_level_object(level)
        info = engine.get_level_info()
        
        self.assertEqual(info['name'], "Test Level")
        self.assertEqual(info['width'], 800)
        self.assertEqual(info['height'], 600)
        self.assertEqual(info['entity_count'], 4)
        self.assertEqual(info['entities']['players'], 1)
        self.assertEqual(info['entities']['enemies'], 2)
        self.assertEqual(info['entities']['platforms'], 1)
    
    def test_render_ascii(self):
        """Test ASCII rendering."""
        engine = GameEngine()
        level = Level("Test Level", 800, 600)
        level.add_entity(Player(100, 500))
        
        engine.load_level_object(level)
        output = engine.render_ascii()
        
        self.assertIn("Test Level", output)
        self.assertIn("P=Player", output)
        self.assertIn("P", output)  # Player should be in the grid


if __name__ == '__main__':
    unittest.main()
