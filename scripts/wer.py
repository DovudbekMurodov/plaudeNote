import re, sys
def norm(s):
    s = s.lower().replace("’", "'").replace("ʻ", "'").replace("`", "'").replace("‘", "'")
    s = re.sub(r"[^\w' ]+", " ", s)
    return s.split()
def wer(ref, hyp):
    r, h = norm(ref), norm(hyp)
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            cur = d[j]
            d[j] = min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
            prev = cur
    return d[len(h)] / max(1, len(r))
if __name__ == "__main__":
    ref = open(sys.argv[1]).read(); hyp = open(sys.argv[2]).read()
    print(f"{wer(ref, hyp)*100:.1f}")
