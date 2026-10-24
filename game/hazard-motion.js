function updateHazards() {
  for (const h of hazards) {
    h.hitFlash = Math.max(0, h.hitFlash - 1);
    if (h.vx) {
      h.x += h.vx;
      if (h.type === "circle") {
        const minX = h.minX ?? h.r;
        const maxX = h.maxX ?? W - h.r;
        if (h.x - h.r < minX || h.x + h.r > maxX) {
          h.vx *= -1;
          h.x = clamp(h.x, minX + h.r, maxX - h.r);
        }
      } else {
        const minX = h.minX ?? 0;
        const maxX = h.maxX ?? W - h.w;
        if (h.x < minX || h.x > maxX) {
          h.vx *= -1;
          h.x = clamp(h.x, minX, maxX);
        }
      }
    }
    if (h.vy) {
      h.y += h.vy;
      if (h.type === "circle") {
        const minY = h.minY ?? h.r;
        const maxY = h.maxY ?? H - h.r;
        if (h.y - h.r < minY || h.y + h.r > maxY) {
          h.vy *= -1;
          h.y = clamp(h.y, minY + h.r, maxY - h.r);
        }
      } else {
        const minY = h.minY ?? 0;
        const maxY = h.maxY ?? H - h.h;
        if (h.y < minY || h.y > maxY) {
          h.vy *= -1;
          h.y = clamp(h.y, minY, maxY);
        }
      }
    }
  }
}
