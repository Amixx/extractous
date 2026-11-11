import ai.yobix.StringResult;
import ai.yobix.TikaNativeMain;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.nio.file.Path;
import org.apache.tika.parser.microsoft.OfficeParserConfig;
import org.apache.tika.parser.ocr.TesseractOCRConfig;
import org.apache.tika.parser.pdf.PDFParserConfig;

/**
 * Extracts every file named on the command line the way the extractous crate
 * does through JNI: parseBytesToString from a direct buffer, as text and as
 * XHTML, with the parser configs that crate's defaults build.
 */
public class RecordTikaMetadata {
    public static void main(String[] args) throws Exception {
        int failures = 0;
        for (String file : args) {
            byte[] bytes = Files.readAllBytes(Path.of(file));
            for (boolean asXml : new boolean[] {false, true}) {
                ByteBuffer buffer = ByteBuffer.allocateDirect(bytes.length);
                buffer.put(bytes).flip();
                StringResult result = TikaNativeMain.parseBytesToString(
                        buffer, 100_000_000, pdfConfig(), officeConfig(), ocrConfig(), asXml);
                if (result.isError()) {
                    failures++;
                    System.out.println("error " + file + ": " + result.getErrorMessage());
                } else {
                    System.out.println("ok " + file + " " + result.getContent().length() + " chars");
                }
            }
        }
        System.out.println(failures + " failed extractions");
    }

    private static PDFParserConfig pdfConfig() {
        PDFParserConfig config = new PDFParserConfig();
        config.setExtractInlineImages(false);
        config.setExtractUniqueInlineImagesOnly(false);
        config.setExtractMarkedContent(false);
        config.setExtractAnnotationText(true);
        config.setOcrStrategy("AUTO");
        return config;
    }

    private static OfficeParserConfig officeConfig() {
        OfficeParserConfig config = new OfficeParserConfig();
        config.setExtractMacros(false);
        config.setIncludeDeletedContent(false);
        config.setIncludeMoveFromContent(false);
        config.setIncludeShapeBasedContent(true);
        config.setIncludeHeadersAndFooters(false);
        config.setIncludeMissingRows(false);
        config.setIncludeSlideNotes(true);
        config.setIncludeSlideMasterContent(true);
        config.setConcatenatePhoneticRuns(true);
        config.setExtractAllAlternativesFromMSG(false);
        return config;
    }

    private static TesseractOCRConfig ocrConfig() {
        TesseractOCRConfig config = new TesseractOCRConfig();
        config.setDensity(300);
        config.setDepth(4);
        config.setTimeoutSeconds(130);
        config.setEnableImagePreprocessing(false);
        config.setApplyRotation(false);
        config.setLanguage("eng");
        return config;
    }
}
