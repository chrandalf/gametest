// Game Configuration
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Game State
let gameState = {
    level: 1,
    score: 0,
    shots: 0,
    ball: null,
    isLaunching: false,
    gravity: 0.5,
    animationId: null
};

// Ball Class
class Ball {
    constructor(x, y, vx, vy) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.radius = 10;
        this.active = true;
    }

    update() {
        if (!this.active) return;

        this.vy += gameState.gravity;
        this.x += this.vx;
        this.y += this.vy;

        // Check if ball is out of bounds
        if (this.y > canvas.height + 50 || this.x < -50 || this.x > canvas.width + 50) {
            this.active = false;
            gameState.isLaunching = false;
        }
    }

    draw() {
        if (!this.active) return;

        // Draw ball shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.beginPath();
        ctx.arc(this.x + 3, this.y + 3, this.radius, 0, Math.PI * 2);
        ctx.fill();

        // Draw ball
        const gradient = ctx.createRadialGradient(
            this.x - 3, this.y - 3, 2,
            this.x, this.y, this.radius
        );
        gradient.addColorStop(0, '#ff6b6b');
        gradient.addColorStop(1, '#c92a2a');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();

        // Ball highlight
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.beginPath();
        ctx.arc(this.x - 3, this.y - 3, 3, 0, Math.PI * 2);
        ctx.fill();
    }

    checkCollisionWithWall(wall) {
        if (!this.active) return false;

        // Check if ball intersects with wall
        if (this.x + this.radius > wall.x && 
            this.x - this.radius < wall.x + wall.width) {
            
            // Check each gap
            let inGap = false;
            for (let gap of wall.gaps) {
                if (this.y + this.radius > gap.y && 
                    this.y - this.radius < gap.y + gap.height) {
                    inGap = true;
                    break;
                }
            }

            // If not in gap and colliding, ball hits wall
            if (!inGap && this.y + this.radius > 0 && this.y - this.radius < canvas.height) {
                return true;
            }
        }
        return false;
    }

    checkCollisionWithTarget(target) {
        if (!this.active) return false;

        const dx = this.x - (target.x + target.width / 2);
        const dy = this.y - (target.y + target.height / 2);
        const distance = Math.sqrt(dx * dx + dy * dy);

        return distance < this.radius + Math.min(target.width, target.height) / 2;
    }
}

// Wall Class
class Wall {
    constructor(x, width, gaps) {
        this.x = x;
        this.width = width;
        this.gaps = gaps; // Array of {y, height}
    }

    draw() {
        ctx.fillStyle = '#8B4513';
        ctx.strokeStyle = '#654321';
        ctx.lineWidth = 2;

        // Draw wall in segments (between gaps)
        let currentY = 0;
        
        for (let gap of this.gaps) {
            // Draw wall segment above gap
            if (gap.y > currentY) {
                ctx.fillRect(this.x, currentY, this.width, gap.y - currentY);
                ctx.strokeRect(this.x, currentY, this.width, gap.y - currentY);
            }
            currentY = gap.y + gap.height;
        }

        // Draw final segment from last gap to bottom
        if (currentY < canvas.height) {
            ctx.fillRect(this.x, currentY, this.width, canvas.height - currentY);
            ctx.strokeRect(this.x, currentY, this.width, canvas.height - currentY);
        }

        // Add brick texture
        ctx.strokeStyle = '#654321';
        ctx.lineWidth = 1;
        for (let y = 0; y < canvas.height; y += 20) {
            ctx.beginPath();
            ctx.moveTo(this.x, y);
            ctx.lineTo(this.x + this.width, y);
            ctx.stroke();
        }
    }
}

// Target Class
class Target {
    constructor(x, y, width, height) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
    }

    draw() {
        // Draw target base
        ctx.fillStyle = '#4CAF50';
        ctx.fillRect(this.x, this.y, this.width, this.height);
        
        // Draw target circles
        const centerX = this.x + this.width / 2;
        const centerY = this.y + this.height / 2;
        
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 3;
        
        ctx.beginPath();
        ctx.arc(centerX, centerY, 15, 0, Math.PI * 2);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.arc(centerX, centerY, 8, 0, Math.PI * 2);
        ctx.stroke();
        
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(centerX, centerY, 3, 0, Math.PI * 2);
        ctx.fill();
    }
}

// Level Configuration
function createLevel(levelNum) {
    const wallX = 400;
    const wallWidth = 30;
    let gaps = [];

    switch(levelNum) {
        case 1:
            // Easy - one large gap in middle
            gaps = [{y: 250, height: 100}];
            break;
        case 2:
            // Medium - gap higher up
            gaps = [{y: 150, height: 80}];
            break;
        case 3:
            // Medium - two gaps
            gaps = [
                {y: 150, height: 60},
                {y: 400, height: 60}
            ];
            break;
        case 4:
            // Hard - small gap in middle
            gaps = [{y: 270, height: 60}];
            break;
        case 5:
            // Harder - two small gaps
            gaps = [
                {y: 120, height: 50},
                {y: 430, height: 50}
            ];
            break;
        case 6:
            // Very hard - three small gaps
            gaps = [
                {y: 100, height: 40},
                {y: 280, height: 40},
                {y: 460, height: 40}
            ];
            break;
        default:
            // Progressive difficulty - gaps get smaller and more offset
            const numGaps = Math.min(2 + Math.floor(levelNum / 3), 4);
            const gapHeight = Math.max(40, 100 - levelNum * 3);
            const spacing = canvas.height / (numGaps + 1);
            
            for (let i = 0; i < numGaps; i++) {
                gaps.push({
                    y: spacing * (i + 1) - gapHeight / 2,
                    height: gapHeight
                });
            }
    }

    return {
        wall: new Wall(wallX, wallWidth, gaps),
        target: new Target(650, 500, 60, 60),
        slingshotPos: {x: 100, y: 520}
    };
}

let currentLevel = createLevel(1);

// Slingshot Drawing
function drawSlingshot(x, y, angle, power) {
    // Draw base
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(x - 5, y, 10, 30);
    
    // Draw slingshot arms
    ctx.strokeStyle = '#654321';
    ctx.lineWidth = 4;
    
    ctx.beginPath();
    ctx.moveTo(x - 15, y);
    ctx.lineTo(x - 10, y - 30);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(x + 15, y);
    ctx.lineTo(x + 10, y - 30);
    ctx.stroke();
    
    // Draw elastic band
    if (!gameState.isLaunching) {
        ctx.strokeStyle = '#ff6b6b';
        ctx.lineWidth = 2;
        
        const pullBack = power / 100 * 20;
        const bandX = x - pullBack;
        const bandY = y - 15;
        
        ctx.beginPath();
        ctx.moveTo(x - 10, y - 30);
        ctx.lineTo(bandX, bandY);
        ctx.lineTo(x + 10, y - 30);
        ctx.stroke();
        
        // Draw ball on slingshot
        ctx.fillStyle = '#ff6b6b';
        ctx.beginPath();
        ctx.arc(bandX, bandY, 8, 0, Math.PI * 2);
        ctx.fill();
    }
    
    // Draw angle indicator
    if (!gameState.isLaunching) {
        ctx.strokeStyle = 'rgba(102, 126, 234, 0.5)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        
        const angleRad = (angle * Math.PI) / 180;
        const lineLength = 100;
        const endX = x + Math.cos(angleRad) * lineLength;
        const endY = y - Math.sin(angleRad) * lineLength;
        
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        
        ctx.setLineDash([]);
    }
}

// Draw ground
function drawGround() {
    ctx.fillStyle = '#8B7355';
    ctx.fillRect(0, 550, canvas.width, 50);
    
    // Grass on top
    ctx.fillStyle = '#90EE90';
    ctx.fillRect(0, 545, canvas.width, 5);
}

// Main render function
function render() {
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw elements
    drawGround();
    currentLevel.target.draw();
    currentLevel.wall.draw();
    
    const angle = parseInt(document.getElementById('angleSlider').value);
    const power = parseInt(document.getElementById('powerSlider').value);
    
    drawSlingshot(currentLevel.slingshotPos.x, currentLevel.slingshotPos.y, angle, power);
    
    if (gameState.ball) {
        gameState.ball.draw();
    }
}

// Game loop
function gameLoop() {
    if (gameState.ball && gameState.ball.active) {
        gameState.ball.update();
        
        // Check collision with wall
        if (gameState.ball.checkCollisionWithWall(currentLevel.wall)) {
            gameState.ball.active = false;
            gameState.isLaunching = false;
            showMessage("Hit the wall! Try again.", "error");
        }
        
        // Check collision with target
        if (gameState.ball.checkCollisionWithTarget(currentLevel.target)) {
            gameState.ball.active = false;
            gameState.isLaunching = false;
            levelComplete();
        }
        
        // Check if ball landed on ground past target
        if (gameState.ball.y >= 545 && !gameState.ball.active) {
            showMessage("Missed the target!", "error");
        }
    }
    
    render();
    gameState.animationId = requestAnimationFrame(gameLoop);
}

// Level complete
function levelComplete() {
    gameState.score += 100 * gameState.level;
    gameState.level++;
    
    showMessage(`Level Complete! 🎯`, "success");
    
    setTimeout(() => {
        currentLevel = createLevel(gameState.level);
        document.getElementById('level').textContent = gameState.level;
        document.getElementById('score').textContent = gameState.score;
    }, 1500);
}

// Show message
function showMessage(text, type) {
    // Create message element if it doesn't exist
    let messageEl = document.getElementById('gameMessage');
    if (!messageEl) {
        messageEl = document.createElement('div');
        messageEl.id = 'gameMessage';
        messageEl.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            padding: 20px 40px;
            border-radius: 10px;
            font-size: 1.5em;
            font-weight: bold;
            z-index: 1000;
            animation: fadeInOut 1.5s;
        `;
        document.body.appendChild(messageEl);
    }
    
    messageEl.textContent = text;
    messageEl.style.backgroundColor = type === 'success' ? '#4CAF50' : '#f44336';
    messageEl.style.color = 'white';
    messageEl.style.display = 'block';
    
    setTimeout(() => {
        messageEl.style.display = 'none';
    }, 1500);
}

// Event Listeners
document.getElementById('angleSlider').addEventListener('input', (e) => {
    document.getElementById('angleValue').textContent = e.target.value;
});

document.getElementById('powerSlider').addEventListener('input', (e) => {
    document.getElementById('powerValue').textContent = e.target.value;
});

document.getElementById('launchBtn').addEventListener('click', () => {
    if (gameState.isLaunching) return;
    
    const angle = parseInt(document.getElementById('angleSlider').value);
    const power = parseInt(document.getElementById('powerSlider').value);
    
    // Convert angle to radians
    const angleRad = (angle * Math.PI) / 180;
    
    // Calculate velocity components
    const speed = power / 100 * 20;
    const vx = Math.cos(angleRad) * speed;
    const vy = -Math.sin(angleRad) * speed;
    
    gameState.ball = new Ball(
        currentLevel.slingshotPos.x,
        currentLevel.slingshotPos.y - 15,
        vx,
        vy
    );
    
    gameState.isLaunching = true;
    gameState.shots++;
    document.getElementById('shots').textContent = gameState.shots;
});

document.getElementById('resetBtn').addEventListener('click', () => {
    gameState.ball = null;
    gameState.isLaunching = false;
    currentLevel = createLevel(gameState.level);
});

// Add CSS animation for message
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeInOut {
        0% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
        20% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        80% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        100% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
    }
`;
document.head.appendChild(style);

// Initialize game
document.getElementById('level').textContent = gameState.level;
document.getElementById('score').textContent = gameState.score;
document.getElementById('shots').textContent = gameState.shots;

// Start game loop
gameLoop();
