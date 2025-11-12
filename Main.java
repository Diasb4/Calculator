public class Main {
    private boolean found = false; // флаг найденного совпадения

    public static void main(String[] args) {
        String message = "AABABCDABDABAAA";
        String pattern = "ABCDA";
        Main kmp = new Main();
        kmp.KMPSearch(message, pattern);

        if (kmp.found()) {
            System.out.println("Pattern found");
        } else {
            System.out.println("Pattern not found");
        }
    }

    void KMPSearch(String message, String pattern) {
        int P = pattern.length();
        int M = message.length();

        int[] lps = new int[P];
        computeLPSArray(pattern, P, lps);

        int i = 0;
        int j = 0;
        while (i < M) {
            if (pattern.charAt(j) == message.charAt(i)) {
                i++;
                j++;
            }

            if (j == P) {
                System.out.println("Found pattern at index " + (i - j));
                found = true;
                j = lps[j - 1];
            } else if (i < M && pattern.charAt(j) != message.charAt(i)) {
                if (j != 0)
                    j = lps[j - 1];
                else
                    i++;
            }
        }
    }

    void computeLPSArray(String pattern, int P, int[] lps) {
        int len = 0;
        int i = 1;
        lps[0] = 0;

        while (i < P) {
            if (pattern.charAt(i) == pattern.charAt(len)) {
                len++;
                lps[i] = len;
                i++;
            } else {
                if (len != 0)
                    len = lps[len - 1];
                else {
                    lps[i] = 0;
                    i++;
                }
            }
        }
    }

    boolean found() {
        return found;
    }
}
