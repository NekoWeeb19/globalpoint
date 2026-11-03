// Draws English text labels as PNGs, for the CN client's text drawn into images (bitmap_text frames
// that global has no art for). Each line of the input: name<TAB>width<TAB>height<TAB>text color
// (hex)<TAB>outline color (hex or "none")<TAB>text ("\n" = new line). The text is fitted to the
// box: the largest bold font size that fits, centered.
//
//   java RenderLabels.java <labels.tsv> <out dir> [font name, or a .ttf file]
import java.awt.*;
import java.awt.font.*;
import java.awt.geom.*;
import java.awt.image.BufferedImage;
import java.io.File;
import java.nio.file.*;
import javax.imageio.ImageIO;

public class RenderLabels {
    public static void main(String[] args) throws Exception {
        String fontName = args.length > 2 ? args[2] : "Segoe UI";
        // a font file (e.g. the game's Poppins) is used as it is, without a bold style on top
        Font fileFont = args.length > 2 && args[2].toLowerCase().endsWith(".ttf") ? Font.createFont(Font.TRUETYPE_FONT, new java.io.File(args[2])) : null;
        for (String line : Files.readAllLines(Paths.get(args[0]), java.nio.charset.StandardCharsets.UTF_8)) {
            if (line.isBlank() || line.startsWith("#")) continue;
            String[] p = line.split("\t");
            int w = Integer.parseInt(p[1]), h = Integer.parseInt(p[2]);
            Color fill = new Color(Integer.parseInt(p[3], 16));
            Color outline = p[4].equals("none") ? null : new Color(Integer.parseInt(p[4], 16));
            String[] lines = p[5].split("\\\\n");
            BufferedImage img = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
            Graphics2D g = img.createGraphics();
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
            g.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);
            float pad = outline == null ? 1 : Math.max(2f, h / 14f);
            FontRenderContext frc = g.getFontRenderContext();
            // the largest size whose lines fit inside the box (minus the outline)
            Font font = null;
            for (float size = h; size >= 6; size -= 0.5f) {
                Font f = (fileFont != null ? fileFont : new Font(fontName, Font.BOLD, 10)).deriveFont(size);
                double lh = f.getLineMetrics("Ag", frc).getHeight();
                double maxW = 0;
                for (String l : lines) maxW = Math.max(maxW, new TextLayout(l, f, frc).getBounds().getWidth());
                if (maxW <= w - 2 * pad && lh * lines.length * 0.92 <= h - 2 * pad) { font = f; break; }
            }
            if (font == null) font = (fileFont != null ? fileFont : new Font(fontName, Font.BOLD, 10)).deriveFont(6f);
            LineMetrics lm = font.getLineMetrics("Ag", frc);
            double lh = lm.getHeight() * 0.92;
            double top = (h - lh * lines.length) / 2;
            for (int i = 0; i < lines.length; i++) {
                TextLayout tl = new TextLayout(lines[i], font, frc);
                Rectangle2D b = tl.getBounds();
                double x = (w - b.getWidth()) / 2 - b.getX();
                double y = top + i * lh + lm.getAscent() * 0.96;
                Shape s = tl.getOutline(AffineTransform.getTranslateInstance(x, y));
                if (outline != null) {
                    g.setColor(outline);
                    g.setStroke(new BasicStroke(pad * 2, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
                    g.draw(s);
                }
                g.setColor(fill);
                g.fill(s);
            }
            g.dispose();
            ImageIO.write(img, "png", new File(args[1], p[0] + ".png"));
        }
    }
}
