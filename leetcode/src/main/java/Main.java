import java.util.*;



public class Main {
  public static void main(String[] args) {



  }

  public int zigZagArrays(int n, int l, int r) {

  }


}
/*
Use dynamic programming: let dp[i][dir][x] be the count of length-i sequences ending at value x where dir is the required next comparison (0 = down, 1 = up).

If the required move is up (dir=1) do dp[i+1][0][y] += sum(dp[i][1][x]) for x < y; if the required move is down (dir=0) do dp[i+1][1][y] += sum(dp[i][0][x]) for x > y.

Speed up with prefix/suffix sums so each layer updates in O(m) instead of O(m2); take values mod 109+7.


* */