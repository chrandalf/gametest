"""
Level design system for the game.
This module provides classes for defining and managing game levels.
"""

import json
from typing import List, Dict, Any, Optional


class Entity:
    """Base class for all game entities."""
    
    def __init__(self, x: float, y: float, entity_type: str):
        self.x = x
        self.y = y
        self.entity_type = entity_type
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert entity to dictionary for serialization."""
        return {
            'type': self.entity_type,
            'x': self.x,
            'y': self.y
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Entity':
        """Create entity from dictionary."""
        return cls(data['x'], data['y'], data['type'])


class Player(Entity):
    """Player entity."""
    
    def __init__(self, x: float, y: float):
        super().__init__(x, y, 'player')
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Player':
        """Create player from dictionary."""
        return cls(data['x'], data['y'])


class Enemy(Entity):
    """Enemy entity."""
    
    def __init__(self, x: float, y: float, enemy_type: str = 'basic'):
        super().__init__(x, y, 'enemy')
        self.enemy_type = enemy_type
    
    def to_dict(self) -> Dict[str, Any]:
        data = super().to_dict()
        data['enemy_type'] = self.enemy_type
        return data
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Enemy':
        enemy = cls(data['x'], data['y'], data.get('enemy_type', 'basic'))
        return enemy


class Platform(Entity):
    """Platform entity."""
    
    def __init__(self, x: float, y: float, width: float, height: float):
        super().__init__(x, y, 'platform')
        self.width = width
        self.height = height
    
    def to_dict(self) -> Dict[str, Any]:
        data = super().to_dict()
        data['width'] = self.width
        data['height'] = self.height
        return data
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Platform':
        return cls(data['x'], data['y'], data['width'], data['height'])


class Level:
    """
    Represents a game level with entities and metadata.
    """
    
    def __init__(self, name: str, width: int = 800, height: int = 600):
        self.name = name
        self.width = width
        self.height = height
        self.entities: List[Entity] = []
        self.metadata: Dict[str, Any] = {}
    
    def add_entity(self, entity: Entity) -> None:
        """Add an entity to the level."""
        self.entities.append(entity)
    
    def get_entities_by_type(self, entity_type: str) -> List[Entity]:
        """Get all entities of a specific type."""
        return [e for e in self.entities if e.entity_type == entity_type]
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert level to dictionary for serialization."""
        return {
            'name': self.name,
            'width': self.width,
            'height': self.height,
            'metadata': self.metadata,
            'entities': [e.to_dict() for e in self.entities]
        }
    
    def save(self, filepath: str) -> None:
        """Save level to a JSON file."""
        with open(filepath, 'w') as f:
            json.dump(self.to_dict(), f, indent=2)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Level':
        """Create level from dictionary."""
        level = cls(data['name'], data.get('width', 800), data.get('height', 600))
        level.metadata = data.get('metadata', {})
        
        # Create entities based on type
        for entity_data in data.get('entities', []):
            entity_type = entity_data.get('type')
            if entity_type == 'player':
                entity = Player.from_dict(entity_data)
            elif entity_type == 'enemy':
                entity = Enemy.from_dict(entity_data)
            elif entity_type == 'platform':
                entity = Platform.from_dict(entity_data)
            else:
                entity = Entity.from_dict(entity_data)
            level.add_entity(entity)
        
        return level
    
    @classmethod
    def load(cls, filepath: str) -> 'Level':
        """Load level from a JSON file."""
        with open(filepath, 'r') as f:
            data = json.load(f)
        return cls.from_dict(data)
