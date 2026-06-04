import java.util.*;
import java

public class Main {
  public static void main(String[] args) {
    System.out.println();

  }
  public int earliestFinishTime(int[] landStartTime, int[] landDuration, int[] waterStartTime, int[] waterDuration) {
    int[] l = new int[landStartTime.length];
    int[] w = new int[waterStartTime.length];
    for(int i = 0; i < l.length; i++){
      l[i] = landStartTime[i] + landDuration[i];
    }
    for(int i = 0; i < w.length; i++){
      w[i] = waterStartTime[i] + waterDuration[i];
    }

    Arrays.sort(l);
    Arrays.sort(w);
    int ans = Integer.MAX_VALUE;

    for(int  i = 0; i < w.length; i++){
      if(waterStartTime[i] <= l[0]){
        ans = Math.min(ans, l[0] + waterDuration[i]);
      }else{
        ans = Math.min(ans, waterDuration[i] + waterStartTime[i]);
      }
    }

    for(int i = 0; i < l.length; i++){
      if(landStartTime[i] <= w[0]){
        ans = Math.min(ans, w[0] + landDuration[i]);
      }else{
        ans = Math.min(ans, landStartTime[i] + landDuration[i]);
      }
    }
    return ans;
  }
}
