import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.File;

// Makes one rectangle of a sprite sheet transparent, after checking it is a halftone dot tile (only
// near-white and transparent pixels, with real holes in it). Used by scripts/gen_cn_strip_band.cjs.
//   java ClearRect.java <in.png> <out.png> <x> <y> <w> <h>
// Exit code 2: the rectangle doesn't look like a dot tile (nothing written).
public class ClearRect {
    public static void main(String[] a) throws Exception {
        BufferedImage src = ImageIO.read(new File(a[0]));
        int x = Integer.parseInt(a[2]), y = Integer.parseInt(a[3]), w = Integer.parseInt(a[4]), h = Integer.parseInt(a[5]);
        if (x + w > src.getWidth() || y + h > src.getHeight()) { System.out.println("tile outside the sheet (" + src.getWidth() + "x" + src.getHeight() + ")"); System.exit(2); }
        BufferedImage img = new BufferedImage(src.getWidth(), src.getHeight(), BufferedImage.TYPE_INT_ARGB);
        img.getGraphics().drawImage(src, 0, 0, null);
        int clear = 0, white = 0, other = 0;
        for (int j = y; j < y + h; j++) for (int i = x; i < x + w; i++) {
            int p = img.getRGB(i, j), al = p >>> 24, r = (p >> 16) & 255, g = (p >> 8) & 255, b = p & 255;
            if (al < 16) clear++;
            else if (r > 200 && g > 200 && b > 200) white++;
            else other++;
        }
        int n = w * h;
        if (other > n / 20 || clear < n / 10 || white < n / 50) {
            System.out.println("not a dot tile: clear " + clear + " white " + white + " other " + other);
            System.exit(2);
        }
        for (int j = y; j < y + h; j++) for (int i = x; i < x + w; i++) img.setRGB(i, j, 0);
        ImageIO.write(img, "png", new File(a[1]));
        System.out.println("cleared " + w + "x" + h + " at " + x + "," + y);
    }
}
