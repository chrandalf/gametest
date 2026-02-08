"""
Simple game engine for loading and managing levels.
"""

from typing import Optional
from level import Level


class GameEngine:
    """
    Simple game engine that manages level loading and game state.
    """
    
    def __init__(self):
        self.current_level: Optional[Level] = None
        self.running = False
    
    def load_level(self, filepath: str) -> None:
        """Load a level from file."""
        self.current_level = Level.load(filepath)
        print(f"Loaded level: {self.current_level.name}")
    
    def load_level_object(self, level: Level) -> None:
        """Load a level object directly."""
        self.current_level = level
        print(f"Loaded level: {self.current_level.name}")
    
    def get_level_info(self) -> dict:
        """Get information about the current level."""
        if not self.current_level:
            return {'error': 'No level loaded'}
        
        return {
            'name': self.current_level.name,
            'width': self.current_level.width,
            'height': self.current_level.height,
            'entity_count': len(self.current_level.entities),
            'entities': {
                'players': len(self.current_level.get_entities_by_type('player')),
                'enemies': len(self.current_level.get_entities_by_type('enemy')),
                'platforms': len(self.current_level.get_entities_by_type('platform'))
            }
        }
    
    def render_ascii(self) -> str:
        """Render a simple ASCII representation of the level."""
        if not self.current_level:
            return "No level loaded"
        
        # Create a simple ASCII grid
        width = min(self.current_level.width // 10, 80)
        height = min(self.current_level.height // 10, 40)
        
        grid = [[' ' for _ in range(width)] for _ in range(height)]
        
        # Place entities on the grid
        for entity in self.current_level.entities:
            x = int(entity.x / self.current_level.width * width)
            y = int(entity.y / self.current_level.height * height)
            
            if 0 <= x < width and 0 <= y < height:
                if entity.entity_type == 'player':
                    grid[y][x] = 'P'
                elif entity.entity_type == 'enemy':
                    grid[y][x] = 'E'
                elif entity.entity_type == 'platform':
                    grid[y][x] = '#'
        
        # Convert grid to string
        result = f"Level: {self.current_level.name}\n"
        result += "+" + "-" * width + "+\n"
        for row in grid:
            result += "|" + "".join(row) + "|\n"
        result += "+" + "-" * width + "+\n"
        result += "P=Player, E=Enemy, #=Platform\n"
        
        return result
