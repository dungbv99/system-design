import java.util.*;

class Solution {
  public static long[] dp = new long[1001];

  static {
    dp[0] = 1;
    dp[2] = 1;
    dp[4] = 2;

    for (int i = 6; i <= 1000; i += 2) {
      dp[i] = 0;
      for (int j = 0; j <= i - 2; j += 2) {
        dp[i] += (dp[j] * dp[i-2-j]) % 1000000007;
        dp[i] %= 1000000007;
      }
    }
  }

  public int numberOfWays(int numPeople) {
    if(numPeople == 0){
      return 0;
    }
    return (int) dp[numPeople];
  }

}


public class Main {
  public static void main(String[] args) {

    Solution s = new Solution();
    //abc abcabc cbacba
    System.out.println(s.numberOfWays(100));

  }


  public int maxDistance(String moves) {
    int x = 0;
    int y = 0;
    int cnt = 0;
    for(int i = 0; i < moves.length(); i++){
      if(moves.charAt(i) == 'U'){
        y++;
      }else if(moves.charAt(i) == 'D'){
        y--;
      }else if(moves.charAt(i) == 'R'){
        x++;
      }else if(moves.charAt(i) == 'L'){
        x--;
      }else {
        cnt++;
      }
    }
    return Math.abs(x) + Math.abs(y) + cnt;
  }

  public int maxIceCream(int[] costs, int coins) {
    Arrays.sort(costs);
    int cur = 0;
    int cnt = 0;
    for(int i = 0; i < costs.length; i++){
      if(cur + costs[i] <= coins){
        cnt++;
        cur += costs[i];
      }else{
        break;
      }
    }
    return cnt;
  }



  public static double angleClock(int hour, int minutes) {
    double degreeMinute = (double) (minutes) / 60 * 360;
    double degreeHour = (double) (hour) / 12 * 360 + (double) (minutes) / 60 * 30;
    double ans = Math.abs(degreeHour - degreeMinute);
    return Math.min(ans, 360.0 - ans);
  }

  static class Solution {
    public static long[] dp = new long[1001];

    static {
      dp[0] = 1;
      dp[2] = 1;
      dp[4] = 2;

      for (int i = 6; i <= 1000; i += 2) {
        dp[i] = 0;
        for (int j = 0; j <= i - 2; j += 2) {
          dp[i] += (dp[j] * dp[i-2-j]) % 1000000007;
          dp[i] %= 1000000007;
        }
      }
    }

    public int numberOfWays(int numPeople) {
      if(numPeople == 0){
        return 0;
      }
      return (int) dp[numPeople];
    }

  }

}
/*
* dp[6] = dp[2] * dp[4] + dp[
* */